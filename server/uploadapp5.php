<?php
// uploadapp5.php — client-side de-id upload endpoint (dev).
//
// Forked from uploadapp4.php (the prod endpoint, left untouched) to add
// client-generated gallery thumbnails with a server-side fallback. Point the
// dev build of the app at this; promote to uploadapp4.php when ready to ship.
//
// The desktop app crops + strips metadata locally and uploads finished
// artifacts. This endpoint does NO transcoding in the normal path: it parses
// the "NNN_<basename>" filenames, files each artifact into the archive folder,
// and writes the DB rows. The only ffmpeg here is a FALLBACK that regenerates
// gallery thumbnails (and a poster) for older app versions that don't upload
// them — see ensureSizedThumbs()/the fallback pass near the end.
//
// Deploy to sonoclipshare.com. Tracked here as a reference copy (like
// appversion.php); the live file is the source of truth.

// Force logging to a specific file for debugging
ini_set('log_errors', 1);
ini_set('error_log', '/var/www/uploads/debug_upload.log');
error_log("=== UPLOAD SCRIPT STARTED ===");

// Suppress all output until we're ready to send JSON
ob_start();

session_start();
include('cururl.php');
$murl = curPageURL();
parse_str($murl, $qresult);
$token = $qresult['token'];

// Auth0 token validation
session_start();
if(isset($_SESSION[$token])) {
    $userid = $_SESSION[$token];
} else {
    $fields = 1;
    $fields_as_string = "id_token=" . $token;
    $url = "https://ultrasoundjelly.auth0.com/tokeninfo";

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, $fields);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $fields_as_string);

    $result = curl_exec($ch);
    $obj = json_decode($result);

    if (isset($obj->{'user_id'})) {
        $userid = $obj->{'user_id'};
        $useremail = $obj->{'email'};
        $username = $obj->{'name'};
        $_SESSION[$token] = $obj->{'user_id'};
    } else {
        ob_end_clean();
        header('Content-Type: application/json');
        echo json_encode(['status' => 'error', 'message' => 'Token not valid: ' . $token]);
        exit();
    }
    curl_close($ch);
}

// The gallery thumbnail sizes the website serves from <archive>/thumbs/.
// Keep in sync with THUMB_WIDTHS in js/renderer.js.
$THUMB_WIDTHS = [140, 220, 280];

// FALLBACK ONLY: (re)generate any missing sized thumbnail for one scan from a
// source image (the poster .jpg for clips, the .still.jpg for images). If the
// client already uploaded a size, it's left untouched. Mirrors the old
// uploadapp3.php createThumbnails() profile (scale=<w>:-2, -q:v 3).
function ensureSizedThumbs($storeFolder, $index, $sourceFile, $widths) {
    $thumbsDir = $storeFolder . '/thumbs';
    if (!is_dir($thumbsDir)) {
        mkdir($thumbsDir, 0755, true);
    }
    foreach ($widths as $w) {
        $thumbPath = $thumbsDir . '/' . $index . '_' . $w . '.jpg';
        if (file_exists($thumbPath) && filesize($thumbPath) > 0) {
            continue; // client already uploaded this size — nothing to do
        }
        if (!file_exists($sourceFile)) {
            error_log("FALLBACK: cannot make {$w}px thumb for $index, missing source: $sourceFile");
            continue;
        }
        $cmd = "ffmpeg -i " . escapeshellarg($sourceFile) . " -vf scale=" . $w . ":-2 -q:v 3 " . escapeshellarg($thumbPath) . " 2>/dev/null";
        exec($cmd, $o, $r);
        if ($r === 0 && file_exists($thumbPath)) {
            chmod($thumbPath, 0644);
            error_log("FALLBACK: generated {$w}px thumb for $index");
        } else {
            error_log("FALLBACK: failed {$w}px thumb for $index (rc=$r)");
        }
        $o = [];
    }
}

// Setup variables
$storeFolder = '/var/www/uploads/' . $qresult['f'];
include('dbconnect.php');
$title = mysqli_real_escape_string($conn, urldecode($qresult['t']));
$folder = $qresult['f'];

if (!is_dir($storeFolder)) {
    mkdir($storeFolder, 0755, true);
}

// Clear any output from includes
ob_end_clean();

if (!empty($_FILES)) {
    $total = count($_FILES['file']['tmp_name']);
    $debug_info = []; // Collect debug info for response

    $debug_info[] = "Starting file upload processing - Total files: $total, Folder: $folder, User: $userid";
    error_log("DEBUG: Starting file upload processing - Total files: $total, Folder: $folder, User: $userid");

    if (empty($folder)) {
        $debug_info[] = "ERROR: No folder specified";
        error_log("ERROR: No folder specified");
        header('Content-Type: application/json');
        echo json_encode(['status' => 'error', 'message' => 'No folder specified', 'debug' => $debug_info]);
        exit();
    }

    if (empty($userid)) {
        $debug_info[] = "ERROR: No user ID available";
        error_log("ERROR: No user ID available");
        header('Content-Type: application/json');
        echo json_encode(['status' => 'error', 'message' => 'No user ID available', 'debug' => $debug_info]);
        exit();
    }

    $processed_files = [];
    $archive_created = false;
    $archive_id = null;
    $errors = [];

    $debug_info[] = "Processing chunk with $total files for folder $folder";
    error_log("Processing chunk with $total files for folder $folder");

    // Parse and organize files by filename prefix
    $files_to_process = [];

    for ($i = 0; $i < $total; $i++) {
        $tempFile = $_FILES['file']['tmp_name'][$i];
        $uploadedName = $_FILES['file']['name'][$i];

        // Parse filename prefix (e.g., "001_1.still.jpg" -> prefix = 1)
        $prefix_match = [];
        if (preg_match('/^(\d{3})_(\d+)\.(.+)$/', $uploadedName, $prefix_match)) {
            $sequence_number = (int)$prefix_match[1]; // The 3-digit sequence (001, 002, etc.)
            $prefix = (int)$prefix_match[2]; // The actual file number (1, 2, etc.)
            $extension_part = $prefix_match[3];

            $debug_info[] = "Parsed file: $uploadedName -> sequence: $sequence_number, prefix: $prefix, extension: $extension_part";
            error_log("Parsed file: $uploadedName -> sequence: $sequence_number, prefix: $prefix, extension: $extension_part");

            $files_to_process[] = [
                'prefix' => $prefix,
                'sequence_number' => $sequence_number,
                'temp_file' => $tempFile,
                'uploaded_name' => $uploadedName,
                'extension_part' => $extension_part,
                'index' => $i
            ];
        } else {
            $debug_info[] = "WARNING: Could not parse filename: $uploadedName";
            error_log("WARNING: Could not parse filename: $uploadedName");
            $errors[] = "Could not parse filename: $uploadedName";
        }
    }

    // Get or create archive
    $sql = 'SELECT * from archives where archive_folder = "' . $folder . '"';
    $result = $conn->query($sql);

    $debug_info[] = "Checking for existing archive with folder: $folder";
    error_log("DEBUG: Checking for existing archive with folder: $folder");

    if ($result->num_rows == 0) {
        $debug_info[] = "Archive not found, creating new archive";
        error_log("DEBUG: Archive not found, creating new archive");
        // Get next archive index
        $sql2 = 'select last_archive_index from users where user_id="' . $userid . '"';
        $result2 = $conn->query($sql2);
        $row2 = $result2->fetch_assoc();
        $next_archive_index = $row2['last_archive_index'] + 1;

        $debug_info[] = "Next archive index will be: $next_archive_index";
        error_log("DEBUG: Next archive index will be: $next_archive_index");

        // Create archive entry
        $sql3 = 'INSERT INTO archives (user_id, archive_index, archive_folder, title) VALUES ("' . $userid . '","' . $next_archive_index . '","' . $folder . '","' . $title.'")';
        $debug_info[] = "Archive creation SQL: $sql3";
        error_log("DEBUG: Archive creation SQL: $sql3");

        if ($conn->query($sql3) === TRUE) {
            $debug_info[] = "SUCCESS: Created archive: $next_archive_index for folder $folder";
            error_log("SUCCESS: Created archive: $next_archive_index for folder $folder");

            // AUTOSHARE PROCESSING
            $sql6 = 'SELECT * FROM autoshare WHERE user_id="'.$userid.'"';
            $result6 = $conn->query($sql6);

            if (file_exists('upload_helper.php')) {
                require_once('upload_helper.php');
                while ($row6 = $result6->fetch_assoc()) {
                    $toemail = $row6['email'];
                    $toname = $row6['name'];
                    processAutoshare($toemail, $toname, $folder, $userid, $username, $useremail, $conn);
                }
            }

            // Log upload location
            if (!isset($ipAddress)) {
                $ipAddress = $_SERVER['REMOTE_ADDR'];
                if (array_key_exists('HTTP_X_FORWARDED_FOR', $_SERVER)) {
                    $ipAddress = reset(explode(',',$_SERVER["HTTP_X_FORWARDED_FOR"]));
                }
                $details = json_decode(file_get_contents("http://ipinfo.io/{$ipAddress}/json"));
                $city = $details->city ?? '';
                $region = $details->region ?? '';
                $country = $details->country ?? '';
            }

            $sql9 = 'INSERT INTO upload_log (archive_id, city, region, country, ip, scans) VALUES ("' . $next_archive_index . '","' . $city . '","' . $region . '","' . $country . '","' . $ipAddress . '","0")';
            $conn->query($sql9);

            // Increment next_archive_index for this user
            $sql6 = 'UPDATE users SET last_archive_index="' . $next_archive_index . '" WHERE user_id="' . $userid . '"';
            $conn->query($sql6);

            $archive_created = true;

        } else {
            $errors[] = "Error creating archive: " . $conn->error;
            error_log("ERROR: Failed to create archive: " . $conn->error);
            error_log("ERROR: Archive creation MySQL Error Number: " . $conn->errno);
        }
    } else {
        $archive_created = true;
        error_log("DEBUG: Found existing archive for folder: $folder");
    }

    if (!$archive_created) {
        error_log("FATAL: Archive creation failed, stopping file processing");
        header('Content-Type: application/json');
        echo json_encode([
            'status' => 'error',
            'message' => 'Failed to create or find archive',
            'errors' => $errors
        ]);
        exit();
    }

    // Get archive_id
    $sql9 = 'SELECT * from archives where archive_folder = "' . $folder . '"';
    $result9 = $conn->query($sql9);
    if ($result9 && $result9->num_rows > 0) {
        $row9 = $result9->fetch_assoc();
        $archive_id = $row9['archive_id'];
        error_log("DEBUG: Found archive_id: $archive_id for folder: $folder");
    } else {
        error_log("FATAL: Could not retrieve archive_id for folder: $folder");
        header('Content-Type: application/json');
        echo json_encode([
            'status' => 'error',
            'message' => 'Could not retrieve archive ID',
            'errors' => $errors
        ]);
        exit();
    }

    // Get the current highest scan_id for this archive to maintain sequential numbering
    $sql_max_scan = 'SELECT MAX(scan_id) as max_scan_id from scans where archive_folder="' . $folder . '"';
    $result_max_scan = $conn->query($sql_max_scan);
    if ($result_max_scan) {
        $row_max_scan = $result_max_scan->fetch_assoc();
        $current_scan_id = ($row_max_scan['max_scan_id'] ?? 0);
        error_log("DEBUG: Current max scan_id for folder $folder: $current_scan_id");
    } else {
        $current_scan_id = 0;
        error_log("ERROR: Could not query max scan_id, starting from 0: " . $conn->error);
    }

    error_log("Starting scan_id sequence from: " . ($current_scan_id + 1));

    // Debug: Log all parsed files
    $debug_info[] = "Total files parsed: " . count($files_to_process);
    error_log("DEBUG: Total files parsed: " . count($files_to_process));
    foreach ($files_to_process as $debug_file) {
        $debug_msg = "Parsed file - Name: {$debug_file['uploaded_name']}, Sequence: {$debug_file['sequence_number']}, Prefix: {$debug_file['prefix']}, Extension: {$debug_file['extension_part']}";
        $debug_info[] = $debug_msg;
        error_log("DEBUG: " . $debug_msg);
    }

    // Sort files by prefix to ensure correct processing order
    usort($files_to_process, function($a, $b) {
        // Primary sort by prefix (1, 2, 3, etc.)
        if ($a['prefix'] != $b['prefix']) {
            return $a['prefix'] - $b['prefix'];
        }
        // Secondary sort by sequence_number for same prefix (thumbnails vs videos)
        return $a['sequence_number'] - $b['sequence_number'];
    });

    $debug_info[] = "Files sorted by prefix for processing:";
    error_log("DEBUG: Files sorted by prefix for processing:");
    foreach ($files_to_process as $debug_file) {
        $debug_msg = "  Processing order - Name: {$debug_file['uploaded_name']}, Prefix: {$debug_file['prefix']}";
        $debug_info[] = $debug_msg;
        error_log("DEBUG: " . $debug_msg);
    }

    // Process files individually
    foreach ($files_to_process as $file_info) {
        $prefix = $file_info['prefix'];
        $tempFile = $file_info['temp_file'];
        $uploadedName = $file_info['uploaded_name'];
        $extension_part = $file_info['extension_part'];

        // Calculate sequence based on prefix: prefix * 1000000000
        $db_sequence = $prefix * 1000000000;

        // Use prefix directly as scan_id (not incremental)
        $scan_id = $prefix;

        error_log("Processing file: $uploadedName (prefix: $prefix, extension: '$extension_part', sequence: $db_sequence, scan_id: $scan_id)");
        $debug_info[] = "Processing file: $uploadedName (prefix: $prefix, scan_id: $scan_id)";

        // Determine file type and whether it needs a scan entry
        $needs_scan_entry = false;
        $scan_type = '';

        if (strpos($extension_part, 'mp4') !== false) {
            // Video file - needs scan entry
            $needs_scan_entry = true;
            $scan_type = 'mp4';
            $final_filename = sprintf("%03d", $scan_id) . '.mp4';
            error_log("DEBUG: Video file detected - scan_id will be: $scan_id");
        } elseif (strpos($extension_part, 'still.jpg') !== false) {
            // Standalone image - needs scan entry
            $needs_scan_entry = true;
            $scan_type = 'jpg';
            $final_filename = sprintf("%03d", $scan_id) . '.still.jpg';
            error_log("DEBUG: Still image detected - scan_id will be: $scan_id");
        } elseif (preg_match('/^(\d+)\.jpg$/', $extension_part, $wmatch)) {
            // Sized gallery thumbnail (e.g. "140.jpg") -> thumbs/NNN_<width>.jpg.
            // Client-generated; no scan entry. MUST be tested before the generic
            // 'jpg' branch below (which would otherwise swallow it).
            $needs_scan_entry = false;
            $thumb_width = (int)$wmatch[1];
            $final_filename = 'thumbs/' . sprintf("%03d", $scan_id) . '_' . $thumb_width . '.jpg';
            $thumbsDir = $storeFolder . '/thumbs';
            if (!is_dir($thumbsDir)) {
                mkdir($thumbsDir, 0755, true);
            }
            error_log("DEBUG: Sized thumbnail detected - width: $thumb_width, scan_id: $scan_id");
        } elseif (strpos($extension_part, 'jpg') !== false) {
            // Poster thumbnail for a clip - no scan entry, but move to folder
            $needs_scan_entry = false;
            // Use the same scan_id as the corresponding video (same prefix)
            $final_filename = sprintf("%03d", $scan_id) . '.jpg';
            error_log("DEBUG: Thumbnail detected - no scan entry needed, using scan_id: $scan_id");
        } else {
            error_log("Unknown file type: $uploadedName (extension_part: '$extension_part')");
            $errors[] = "Unknown file type: $uploadedName";
            continue;
        }

        error_log("DEBUG: File $uploadedName - needs_scan_entry: " . ($needs_scan_entry ? 'YES' : 'NO') . ", scan_type: '$scan_type', final_filename: $final_filename");

        // Move file to final location
        $finalPath = $storeFolder . '/' . $final_filename;

        if (move_uploaded_file($tempFile, $finalPath)) {
            chmod($finalPath, 0644);
            error_log("Moved file: $uploadedName -> $finalPath");

            // Create scan entry if needed
            if ($needs_scan_entry) {
                error_log("DEBUG: About to create scan entry - scan_id: $scan_id, archive_id: $archive_id, folder: $folder, scan_type: $scan_type, sequence: $db_sequence");

                $sql5 = 'INSERT INTO scans (scan_id, archive_id, archive_folder, scan_type, sequence) VALUES ("' . $scan_id . '","' . $archive_id . '","' . $folder . '","' . $scan_type . '","' . $db_sequence . '")';
                error_log("DEBUG: SQL Query: $sql5");

                if ($conn->query($sql5) === TRUE) {
                    $processed_files[] = [
                        'filename' => $uploadedName,
                        'final_filename' => $final_filename,
                        'scan_id' => $scan_id,
                        'scan_type' => $scan_type,
                        'file_prefix' => $prefix,
                        'sequence' => $db_sequence,
                        'status' => 'completed'
                    ];

                    error_log("SUCCESS: Created scan entry: scan_id=$scan_id, sequence=$db_sequence, type=$scan_type");

                    // Update scan counts
                    if ($scan_type == 'mp4') {
                        $sqlscaninc = 'UPDATE archives SET mp4 = mp4 + 1 WHERE archive_folder = "' . $folder . '"';
                        error_log("DEBUG: Updating mp4 count for archive");
                    } else {
                        $sqlscaninc = 'UPDATE archives SET jpg = jpg + 1 WHERE archive_folder = "' . $folder . '"';
                        error_log("DEBUG: Updating jpg count for archive");
                    }

                    if ($conn->query($sqlscaninc) === TRUE) {
                        error_log("SUCCESS: Updated archive scan counts");
                    } else {
                        error_log("ERROR: Failed to update archive counts: " . $conn->error);
                    }

                    // Update upload_log
                    $sql6 = 'SELECT * FROM upload_log WHERE archive_id="' . $archive_id . '"';
                    $result6 = $conn->query($sql6);
                    if ($result6 && $row6 = $result6->fetch_assoc()) {
                        $scans = $row6['scans'] + 1;
                        $sql7 = 'UPDATE upload_log SET scans="' . $scans . '" WHERE archive_id="' . $archive_id . '"';
                        if ($conn->query($sql7) === TRUE) {
                            error_log("SUCCESS: Updated upload_log scan count to $scans");
                        } else {
                            error_log("ERROR: Failed to update upload_log: " . $conn->error);
                        }
                    } else {
                        error_log("ERROR: Could not find upload_log entry for archive_id: $archive_id");
                    }

                } else {
                    $errors[] = "Error creating scan entry for $uploadedName: " . $conn->error;
                    error_log("ERROR: Failed to create scan entry: " . $conn->error);
                    error_log("ERROR: MySQL Error: " . $conn->error);
                    error_log("ERROR: MySQL Error Number: " . $conn->errno);
                }
            } else {
                // Thumbnail file (poster or sized) - just record that we moved it
                $processed_files[] = [
                    'filename' => $uploadedName,
                    'final_filename' => $final_filename,
                    'scan_id' => null,
                    'scan_type' => 'thumbnail',
                    'file_prefix' => $prefix,
                    'sequence' => null,
                    'status' => 'moved_no_scan_entry'
                ];
                error_log("Moved thumbnail (no scan entry): $uploadedName -> $final_filename");
            }

        } else {
            $errors[] = "Error moving file: $uploadedName";
            error_log("Failed to move file: $uploadedName");
        }
    }

    // Fix thumbnail naming for any temp files
    foreach ($processed_files as &$file) {
        if ($file['scan_type'] == 'thumbnail' && strpos($file['final_filename'], 'temp_') === 0) {
            // Find the corresponding video scan_id
            $prefix = $file['file_prefix'];
            $video_scan_id = null;
            foreach ($processed_files as $other_file) {
                if ($other_file['file_prefix'] == $prefix && $other_file['scan_type'] == 'mp4') {
                    $video_scan_id = $other_file['scan_id'];
                    break;
                }
            }

            if ($video_scan_id) {
                $old_path = $storeFolder . '/' . $file['final_filename'];
                $new_filename = sprintf("%03d", $video_scan_id) . '.jpg';
                $new_path = $storeFolder . '/' . $new_filename;

                if (file_exists($old_path) && rename($old_path, $new_path)) {
                    $file['final_filename'] = $new_filename;
                    error_log("Fixed thumbnail naming: {$file['filename']} -> $new_filename");
                }
            }
        }
    }
    unset($file);

    // FALLBACK PASS: make sure every scan has its poster + 140/220/280 thumbs.
    // Modern app versions upload these, so each ensureSizedThumbs() call is a
    // cheap set of file_exists() checks. Old versions (or any size that failed
    // client-side) get regenerated here, so the gallery is never missing a
    // thumbnail regardless of which app produced the upload.
    foreach ($processed_files as $pf) {
        if ($pf['scan_type'] === 'mp4') {
            $index = sprintf("%03d", $pf['scan_id']);
            $poster = $storeFolder . '/' . $index . '.jpg';
            $video  = $storeFolder . '/' . $index . '.mp4';
            // Poster missing (old client never sent one) -> extract from video,
            // matching the old uploadapp3.php behavior (-ss 1 -vframes 1).
            if (!file_exists($poster) && file_exists($video)) {
                $cmd = "ffmpeg -i " . escapeshellarg($video) . " -ss 1 -vframes 1 -q:v 2 " . escapeshellarg($poster) . " 2>/dev/null";
                exec($cmd, $po, $pr);
                if ($pr === 0 && file_exists($poster)) {
                    chmod($poster, 0644);
                    error_log("FALLBACK: extracted poster for $index");
                }
            }
            ensureSizedThumbs($storeFolder, $index, $poster, $THUMB_WIDTHS);
        } elseif ($pf['scan_type'] === 'jpg') {
            $index = sprintf("%03d", $pf['scan_id']);
            $still = $storeFolder . '/' . $index . '.still.jpg';
            ensureSizedThumbs($storeFolder, $index, $still, $THUMB_WIDTHS);
        }
    }

    error_log("Chunk processing completed. Processed " . count($processed_files) . " files.");
    $debug_info[] = "Chunk processing completed. Processed " . count($processed_files) . " files.";

    // Send JSON response
    header('Content-Type: application/json');
    $response = [
        'status' => 'success',
        'upload_id' => $folder,
        'archive_id' => $archive_id,
        'total_files' => $total,
        'processed_files' => count($processed_files),
        'files' => $processed_files,
        'errors' => $errors,
        'debug' => $debug_info, // Include debug info in response
        'message' => "Processed " . count($processed_files) . " files with sequence based on filename prefix"
    ];

    echo json_encode($response);

} else {
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'No files received',
        'debug' => ['No files in $_FILES array']
    ]);
}

$conn->close();
?>
