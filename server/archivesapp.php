<?php
/**
 * archivesapp.php — the archive picker feed for the desktop uploader (dev).
 *
 * DEPLOY TO: /var/www/sonoclipshare.com/archivesapp.php
 * Tracked here as a reference copy (like uploadapp5.php/appversion.php); the
 * live file is the source of truth.
 *
 * WHY THIS EXISTS
 *
 * myarchivesapp.php returns `WHERE user_id = ?`, unpaged and unsearchable, and
 * the app renders it into a <select>. Two things it cannot do: list the
 * archives OTHER people have shared with you (which the app can now upload
 * into), and stay usable for the accounts that own 1,500 of them.
 *
 * The mobile API already has both halves — `my-archives` and `shared-archives`,
 * with search and paging. It is not reachable from here: it wants
 * `Authorization: Bearer <jwt>` with aud = https://api.sonoclipshare.com/, and
 * the desktop client's Auth0 id_token carries aud = the desktop client id. So
 * this is the same shim shape as the upload endpoints — `?token=` in, the
 * app's JSON out — rather than a fourth copy of the archive queries.
 *
 * myarchivesapp.php is left ALONE. The 2.2.x clients that call it (144 hits in
 * the retained window) will never ship a new build.
 *
 * CONTRACT
 *
 *   GET archivesapp.php?token=<id_token>[&q=][&scope=all|mine|shared][&page=1][&limit=30]
 *
 *   {"status":"success","page":1,"limit":30,"total":214,"archives":[
 *      {"folder":"aB3xY9kQ2m","title":"FAST exam","date":"2026-08-01 14:22:05",
 *       "archive":37,"scope":"shared","owner_name":"Jane Roe",
 *       "owner_email":"jane@…","mp4":6,"jpg":2,"next_scan":9,"thumb":"https://…"}]}
 *
 * `next_scan` is the contract that matters. uploadapp5.php takes scan_id
 * straight from the client's `NNN_` filename prefix, so a client that restarts
 * at 001 when appending overwrites 001.mp4 and inserts a duplicate scans row —
 * the fault that left 850 duplicated pairs across 231 archives. The app starts
 * its prefixes at `next_scan`, and it must come from here because only the
 * server knows what is already in someone else's archive.
 *
 * PHP 7.4 compatible.
 */

ini_set('display_errors', '0');
ini_set('log_errors', '1');

/** JSON out, buffer discarded. Never returns. */
function scs_archives_out($payload, $status = 200)
{
    while (ob_get_level() > 0) { ob_end_clean(); }
    header('Content-Type: application/json');
    http_response_code($status);
    echo json_encode($payload);
    exit();
}

ob_start();

$authPath = __DIR__ . '/upload_auth.php';
if (!is_readable($authPath)) {
    error_log('[archivesapp] upload_auth.php missing at ' . $authPath);
    scs_archives_out(['status' => 'error', 'message' => 'Server misconfigured'], 500);
}
require_once $authPath;

// false: a desktop client has no browser session, so falling back to one could
// only ever match somebody else's cookie, never the intended user.
list($userid, $username, $useremail) = scs_upload_auth(false);

include('dbconnect.php');
ob_end_clean();

// ---- inputs -----------------------------------------------------------------

$q     = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
$scope = isset($_GET['scope']) ? (string)$_GET['scope'] : 'all';
if ($scope !== 'mine' && $scope !== 'shared') { $scope = 'all'; }

$page  = isset($_GET['page']) ? (int)$_GET['page'] : 1;
if ($page < 1) { $page = 1; }
// 100 is the same order as the API's cap. The picker asks for 30 and pages as
// the list is scrolled, so this only bounds a hand-written request.
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 30;
if ($limit < 1)   { $limit = 1; }
if ($limit > 100) { $limit = 100; }
$offset = ($page - 1) * $limit;

// A title containing % or _ is a literal, not a wildcard. Without this,
// searching for "50_2" matches every title with "50" plus any character.
$hasQ = ($q !== '');
$like = '%' . addcslashes($q, '%_\\') . '%';

// ---- the two halves ---------------------------------------------------------
//
// Column names come from the FIRST arm of a UNION, so in the combined query the
// shared arm's aliases are ignored — but scope=shared runs that arm ALONE, and
// then `ORDER BY t.date` has to find a column called `date` rather than
// `MAX(a.ts_update)`. Both arms are aliased for that reason.
//
// The shared arm aggregates every column because it GROUPs BY folder: one
// archive can carry several `shared` rows for the same receiver (re-shared, or
// shared and then filed into a folder), and the picker must list it once.

$mineSql = "SELECT a.archive_folder AS folder,
                   a.title          AS title,
                   a.ts_update      AS date,
                   a.archive_index  AS archive,
                   a.mp4            AS mp4,
                   a.jpg            AS jpg,
                   'mine'           AS scope,
                   ''               AS owner_name,
                   ''               AS owner_email
              FROM archives a
             WHERE a.user_id = ?" . ($hasQ ? " AND a.title LIKE ?" : "");

$sharedSql = "SELECT a.archive_folder      AS folder,
                     MAX(a.title)         AS title,
                     MAX(a.ts_update)     AS `date`,
                     MAX(a.archive_index) AS archive,
                     MAX(a.mp4)           AS mp4,
                     MAX(a.jpg)           AS jpg,
                     'shared'             AS scope,
                     MAX(s.sender_name)   AS owner_name,
                     MAX(s.sender_email)  AS owner_email
                FROM shared s
                JOIN archives a ON a.archive_folder = s.archive_folder
               WHERE s.receiver_user_id = ?
                 AND a.user_id <> ?" . ($hasQ ? " AND a.title LIKE ?" : "") . "
               GROUP BY a.archive_folder";

$params = [];
if ($scope === 'mine') {
    $body = $mineSql;
    $params[] = $userid;
    if ($hasQ) { $params[] = $like; }
} elseif ($scope === 'shared') {
    $body = $sharedSql;
    $params[] = $userid;
    $params[] = $userid;
    if ($hasQ) { $params[] = $like; }
} else {
    $body = $mineSql . " UNION ALL " . $sharedSql;
    $params[] = $userid;
    if ($hasQ) { $params[] = $like; }
    $params[] = $userid;
    $params[] = $userid;
    if ($hasQ) { $params[] = $like; }
}

/**
 * Prepare + bind + execute, or answer 500.
 *
 * Both failure shapes are handled because the two differ by PHP version: 7.4
 * returns false from prepare(), 8.x throws mysqli_sql_exception (mysqli's
 * default error mode changed in 8.1). Uncaught, the 8.x form is an empty 500
 * with no JSON body, which the app cannot tell from a dead host.
 */
function scs_archives_run($conn, $sql, $types, $params)
{
    try {
        $stmt = $conn->prepare($sql);
        if ($stmt === false) {
            throw new RuntimeException($conn->error);
        }
        if ($types !== '') {
            $stmt->bind_param($types, ...$params);
        }
        $stmt->execute();
        return $stmt;
    } catch (Throwable $e) {
        error_log('[archivesapp] query failed: ' . $e->getMessage() . ' | ' . $sql);
        scs_archives_out(['status' => 'error', 'message' => 'Query failed'], 500);
    }
}

// ---- total, then the page ---------------------------------------------------

$countStmt = scs_archives_run(
    $conn,
    "SELECT COUNT(*) AS total FROM ( $body ) t",
    str_repeat('s', count($params)),
    $params
);
$total = (int) $countStmt->get_result()->fetch_assoc()['total'];
$countStmt->close();

$pageParams = $params;
$pageParams[] = $limit;
$pageParams[] = $offset;

$stmt = scs_archives_run(
    $conn,
    "SELECT * FROM ( $body ) t ORDER BY t.`date` DESC LIMIT ? OFFSET ?",
    str_repeat('s', count($params)) . 'ii',
    $pageParams
);
$result = $stmt->get_result();

$archives = [];
$folders  = [];
while ($row = $result->fetch_assoc()) {
    $folder = $row['folder'];
    $folders[] = $folder;
    $archives[] = [
        'folder'      => $folder,
        'title'       => $row['title'],
        'date'        => $row['date'],
        'archive'     => (int)$row['archive'],
        'scope'       => $row['scope'],
        'owner_name'  => $row['owner_name'],
        'owner_email' => $row['owner_email'],
        'mp4'         => (int)$row['mp4'],
        'jpg'         => (int)$row['jpg'],
        // Filled in below. 0 means "start numbering at 1", which is what an
        // archive with no scans wants anyway.
        'next_scan'   => 0,
        'thumb'       => null,
    ];
}
$stmt->close();

// ---- scan numbering + thumbnail, one query for the whole page ---------------
//
// MAX(scan_id) is where this archive's numbering continues from; the lowest
// live scan_id is what the tile shows. Deleted scans carry scan_type 'del'
// (archive.php filters on the same value), and an archive whose first scan was
// deleted is common enough -- 6,605 of them -- that ignoring it would show a
// broken image on 7.7% of rows.
//
// Note this differs from the website, which picks the first scan by SEQUENCE
// rather than by id. They diverge in real data; for a 56px picker tile the
// cheaper single-pass aggregate is the right trade.

if ($folders) {
    $in = implode(',', array_fill(0, count($folders), '?'));
    $scanStmt = scs_archives_run(
        $conn,
        "SELECT archive_folder,
                MAX(scan_id) AS max_scan,
                MIN(CASE WHEN scan_type <> 'del' THEN scan_id END) AS first_scan
           FROM scans
          WHERE archive_folder IN ($in)
          GROUP BY archive_folder",
        str_repeat('s', count($folders)),
        $folders
    );
    $scanRes = $scanStmt->get_result();

    $byFolder = [];
    while ($row = $scanRes->fetch_assoc()) {
        $byFolder[$row['archive_folder']] = $row;
    }
    $scanStmt->close();

    foreach ($archives as &$a) {
        if (!isset($byFolder[$a['folder']])) { continue; }
        $a['next_scan'] = (int)$byFolder[$a['folder']]['max_scan'];
        $first = $byFolder[$a['folder']]['first_scan'];
        if ($first !== null) {
            $a['thumb'] = scs_archives_thumb($a['folder'], (int)$first);
        }
    }
    unset($a);
}

$conn->close();

scs_archives_out([
    'status'   => 'success',
    'page'     => $page,
    'limit'    => $limit,
    'total'    => $total,
    'archives' => $archives,
]);

/**
 * A signed /secure link to an archive's 140px thumbnail.
 *
 * Same scheme as the API's buildSecureLink(): nginx secure_link over
 * MEDIA_SIGN_SECRET. Returns null when the secret is not in the environment, so
 * a misconfigured host loses the picture and keeps the picker -- the app
 * renders its own placeholder tile for null.
 */
function scs_archives_thumb($folder, $scanId)
{
    if ($scanId < 1) { return null; }

    $secret = getenv('MEDIA_SIGN_SECRET');
    if (!$secret) {
        error_log('[archivesapp] MEDIA_SIGN_SECRET not set; serving picker without thumbnails');
        return null;
    }

    $path    = '/secure/' . $folder . '/thumbs/' . sprintf('%03d', $scanId) . '_140.jpg';
    $expires = time() + 1800;

    $md5 = md5("$expires$path $secret", true);
    $md5 = base64_encode($md5);
    $md5 = strtr($md5, '+/', '-_');
    $md5 = str_replace('=', '', $md5);

    return 'https://www.sonoclipshare.com' . $path . '?md5=' . $md5 . '&expires=' . $expires;
}
