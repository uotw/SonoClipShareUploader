// Complete Electron renderer with smooth de-identification progress bars
const $ = window.jQuery = window.$ = require('jquery');

// Test that jQuery loaded
console.log('jQuery version:', $.fn.jquery);

const FFmpegWrapper = require('./js/ffmpeg-wrapper');
const ffmpeg = new FFmpegWrapper();
window.ffmpeg = ffmpeg;

var remote = require('@electron/remote')
const {
	ipcRenderer
} = require('electron')
var version = remote.app.getVersion();
const os = require('os');
const ostemp = os.tmpdir()
var FormData = require('form-data');

const Store = require('electron-store');
const store = new Store();

if (store.get('cropWidth')) {
    window.cropW = store.get('cropWidth');
    window.cropH = store.get('cropHeight');
    window.cropX = store.get('cropXstart');
    window.cropY = store.get('cropYstart');
}

const {
	shell
} = require('electron');

var filelist = [];
var widtharr = [];
var heightarr = [];
var croppixelarr = [];
var canvasaspect;
var path = require('path');
workdir = path.join(ostemp,maketemp());
remote.getGlobal('workdirObj').prop1 = workdir;

var id_token = remote.getGlobal('token').thetoken;
console.log('Initial token check:', id_token ? 'Token available' : 'Token is null');

function checkToken() {
    id_token = remote.getGlobal('token').thetoken;
    console.log('Token check:', id_token ? 'Valid' : 'Still null');
    return id_token;
}

// The API access token, for `Authorization: Bearer`. Deliberately NOT falling
// back to the ID token: the API checks the audience claim and would reject it
// with a 401 that looks like an expired session rather than a wrong token.
function checkApiToken() {
    return remote.getGlobal('token').apitoken;
}

console.log('tempdir: ' + remote.getGlobal('workdirObj').prop1);
var previewfile = path.join(workdir,'preview.png');
previewfile=previewfile.split(path.sep).join(path.posix.sep);
var previewindex = 0;
var lastperc = 0;
var lastpercUL = 0;
var fs = require('fs');

var croppedfilelist = [];
var title, folder, finallink;
var ispreviewclip = 1;
window.croppixelperc = 0.09;
var uploadBatchId = null;

// Two independent progress controllers, shown simultaneously:
//   cropController     → #myBar/#label    (de-identification / transcode)
//   progressController  → #myBarUL/#labelUL (upload)
let cropController = null;
let progressController = null;

// Warm up the ffmpeg/ffprobe binaries at app launch so the first encode is snappy.
$(document).ready(function() {
    console.log('Warming up FFmpeg binaries...');

    ffmpeg.warmupBinaries()
        .then(() => console.log('FFmpeg binaries ready (CPU/libx264 encoding)'))
        .catch((error) => console.warn('Binary warmup failed (non-critical):', error));

    init();
});

function maketemp() {
	var text = "";
	var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (var i = 0; i < 10; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
	return text;
}

function isclip(filename) {
	var clipext = ['mp4', 'm4v', 'avi', 'wmv', 'mov', 'flv', 'mpg', 'mpeg'];
	for (var i = 0; i < clipext.length; i++) {
		if (filename.toLowerCase().split('.').pop().indexOf(clipext[i]) >= 0) {
			return (1);
		}
	}
	return (0);
}

function isstill(filename) {
	var stillext = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'gif'];
	for (var i = 0; i < stillext.length; i++) {
		if (filename.toLowerCase().split('.').pop().indexOf(stillext[i]) >= 0) {
			return (1);
		}
	}
	return (0);
}

function search(startPath) {
	var path = require('path');
	var list = [];
	if (!fs.existsSync(startPath)) {
		return;
	}
	var files = fs.readdirSync(startPath);
	for (var i = 0; i < files.length; i++) {
		var filename = path.join(startPath, files[i]);
		var stat = fs.lstatSync(filename);
		if (stat.isDirectory()) {
			var list_temp = [];
			list_temp = search(filename);
			for (var m = 0; m < list_temp.length; m++) {
				list.push(list_temp[m]);
			}
		} else if (isstill(filename) || isclip(filename)) {
			list.push(filename);
		}
	}
	return (list);
}

$('#version').html(version);

// File drop handling
$("#filelistwrap").on('dragenter', function(event) {
	event.stopPropagation();
	event.preventDefault();
});
$("#filelistwrap").on('dragover', function(event) {
	event.stopPropagation();
	event.preventDefault();
});
$("#filelistwrap").on('drop', function(event) {
	ipcRenderer.send('focusnow', 'focus')
	event.preventDefault();
	var files = event.originalEvent.dataTransfer.files;
	
	for (var i = 0; i < files.length; i++) {
		var name = files[i].name;
		var filePath = files[i].path;
		
		if (fs.lstatSync(filePath).isDirectory()) {
			var temp_list = [];
			temp_list = search(filePath);
			for (var k = 0; k < temp_list.length; k++) {
				if (filelist.indexOf(temp_list[k]) == -1) {
					filelist.push(temp_list[k]);
					var index = filelist.length;
					$('#filelist').append(index + ': ' + temp_list[k] + '<br />');
				}
			}
		} else if (isstill(name) || isclip(name)) {
			if (filelist.indexOf(filePath) == -1) {
				filelist.push(filePath);
				var index = filelist.length;
				$('#filelist').append(index + ': ' + filePath + '<br />');
			}
		}
	}
	
	addfilestatus();
	$('#previewbtn').fadeIn();
	$('#clearbtn').fadeIn();
	$('#drag').css('visibility', 'hidden');
});

$('#clearbtn').click(function() {
	filelist = [];
	$('#filelist').html('');
	$('#previewbtn').fadeOut();
	$(this).hide();
	$('#drag').css('visibility', 'visible');
	addfilestatus();
});

$(document).on('dragenter', function(e) {
	e.stopPropagation();
	e.preventDefault();
});
$(document).on('dragover', function(e) {
	e.stopPropagation();
	e.preventDefault();
});
$(document).on('drop', function(e) {
	e.stopPropagation();
	e.preventDefault();
});

function canvasbg(filelist) {
    return new Promise((resolve, reject) => {
        const outputPath = previewfile;
        
        ffmpeg.createCanvasBackground(filelist[0], outputPath)
            .then(() => {
                return ffmpeg.probe(filelist[0]);
            })
            .then((metadata) => {
                resolve(metadata);
            })
            .catch((err) => {
                reject(err);
            });
    });
}

$('#previewbtn').click(function() {
	if (!fs.existsSync(workdir)) {
		fs.mkdirSync(workdir);
	}
	$('#clearbtn').hide();
	$('#filelistwrap').hide();
	$('#previewbtn').hide();
	$('#cropbtn').hide();
	$('#confirm').hide();
	$('#home').hide();
	$('#loading-container').show();
	setTimeout(function() {
		preview();
	}, 10);
});

function showbtns() {
	return () => new Promise((resolve, reject) => {
		$('#home').fadeIn();
		$('#cropbtn').fadeIn();
		$('#manualbtn').fadeIn();
		$('#confirm').fadeIn();
		resolve();
	});
}

function setcropvars() {
    store.set('cropWidth', window.cropW);
    store.set('cropHeight', window.cropH);
    store.set('cropXstart', window.cropX);
    store.set('cropYstart', window.cropY);
}

function queue(tasks) {
	let index = 0;
	const runTask = (arg) => {
		if (index >= tasks.length) {
			return Promise.resolve(arg);
		}
		return new Promise((resolve, reject) => {
			tasks[index++](arg).then(arg => resolve(runTask(arg))).catch(reject);
		});
	}
	return runTask();
}

// Progress controller bound to a specific bar + label element.
// The bar width is animated by a CSS transition (smooth + GPU-friendly); the
// % label is hidden below 5% so a bar never shows a lonely "0%".
function createSmoothProgress(barId, labelId) {
    let value = 0;

    // animate=true → let the CSS width transition glide; false → snap instantly.
    const render = (animate) => {
        const elem = document.getElementById(barId);
        const label = document.getElementById(labelId);
        if (elem) {
            if (!animate) {
                elem.style.transition = 'none';
                elem.style.width = value + '%';
                void elem.offsetWidth;        // flush so the next change animates again
                elem.style.transition = '';
            } else {
                elem.style.width = value + '%';
            }
            if (value >= 100) { elem.classList.add('progress-complete'); }
        }
        if (label) { label.innerHTML = value >= 5 ? Math.round(value) + '%' : ''; }
    };

    return {
        setProgress: (percent) => { value = Math.max(0, Math.min(100, percent)); render(true); },
        stop: () => {},
        getCurrentProgress: () => value,
        isAnimating: () => false,
        reset: () => { value = 0; render(false); },
        // Hard snap to a value with NO animation (used at phase transitions).
        jump: (percent) => { value = Math.max(0, Math.min(100, percent)); render(false); }
    };
}

// The gallery thumbnail sizes the website serves from each archive's /thumbs/
// folder. Generated client-side now (the server keeps a fallback for old apps).
var THUMB_WIDTHS = [140, 220, 280];

// Generate the multi-size gallery thumbnails from a poster (clip) or still
// (image), named "<n>.<width>.jpg" so they upload as "NNN_<n>.<width>.jpg" and
// the server routes them to /thumbs/<NNN>_<width>.jpg. Resolves with the list
// of files that were produced. A failed size is skipped (non-fatal) — the
// server regenerates any missing size on its end.
function makeSizedThumbs(sourceImage, n) {
	var outputs = [];
	var chain = Promise.resolve();
	THUMB_WIDTHS.forEach(function(w) {
		chain = chain.then(function() {
			var out = path.join(workdir, n + '.' + w + '.jpg');
			return ffmpeg.createSizedThumbnail(sourceImage, out, w)
				.then(function() {
					outputs.push(out);
					croppedfilelist.push(out);
				})
				.catch(function(e) {
					console.warn('Sized thumbnail ' + w + 'px failed (server will regenerate):', e.message);
				});
		});
	});
	return chain.then(function() { return outputs; });
}

// POST one job (a clip's mp4+thumbnail, or one still) to uploadapp5.php.
// Files are named "<NNN>_<basename>" (NNN = seqStart+i+1) to match the server's
// prefix-based ordering. Resolves with the parsed JSON on success.
function postFilesToServer(files, uploadlink, seqStart) {
	return new Promise(function(resolve, reject) {
		var form = new FormData();
		for (var i = 0; i < files.length; i++) {
			var thisfile = fs.readFileSync(files[i]);
			var nameonly = path.basename(files[i]);
			var seq = seqStart + i + 1;
			form.append('file[]', thisfile, String(seq).padStart(3, '0') + '_' + nameonly);
		}

		const https = require('https');
		const http = require('http');
		const url = require('url');
		const parsedUrl = url.parse(uploadlink);
		const isHttps = parsedUrl.protocol === 'https:';
		const httpModule = isHttps ? https : http;
		const formData = form.getBuffer();
		const formHeaders = form.getHeaders();
		const options = {
			hostname: parsedUrl.hostname,
			port: parsedUrl.port || (isHttps ? 443 : 80),
			path: parsedUrl.path,
			method: 'POST',
			headers: { ...formHeaders, 'Content-Length': formData.length },
			timeout: 120000
		};

		const req = httpModule.request(options, function(res) {
			let responseData = '';
			res.on('data', function(c) { responseData += c; });
			res.on('end', function() {
				try {
					const data = JSON.parse(responseData);
					if (data.status === 'success') {
						resolve(data);
					} else {
						console.error('Server rejected upload | HTTP ' + res.statusCode + ' | response:', responseData);
						reject(new Error(data.message || 'Upload failed'));
					}
				} catch (e) {
					console.error('Non-JSON server response | HTTP ' + res.statusCode + ' | body:', responseData);
					reject(new Error('Invalid server response (HTTP ' + res.statusCode + ')'));
				}
			});
		});
		req.on('error', function(e) { reject(e); });
		req.on('timeout', function() { req.destroy(); reject(new Error('Upload timeout')); });
		req.write(formData);
		req.end();
	});
}

function progressend(uploadResponse) {
	return () => new Promise((resolve, reject) => {
		if (cropController) { cropController.stop(); }
		if (progressController) { progressController.stop(); }

		$('#myProgress').hide();
		$('#progressmsg').hide();
		$('#myProgressUL').hide();
		$('#progressmsgUL').hide();
		
		if (uploadResponse.status === 'success') {
			finallink = 'https://www.sonoclipshare.com/archive.php?&f=' + uploadResponse.upload_id;
			$('#finallink').html(finallink);
			$('#finallinkwrap').fadeIn();
			$('#addornew').fadeIn();
		} else {
			$('#uploaderrors').html('Upload failed: ' + uploadResponse.message);
			$('#uploaderrors').show();
		}

		filelist = [];
		$('#filelist').html('');
		$('#addtarget').hide();
		$('#drag').css('visibility', 'visible');
		addfilestatus();
		$('#home').fadeIn();

		// The next upload picks its own destination. Leaving these set would
		// carry this archive's scan offset into a brand-new one.
		selectedArchive = null;
		existingScanOffset = 0;
		
		// Reset progress bar
		$('#myBarUL').css('width', '0');
		document.getElementById("labelUL").innerHTML = "0%";
		
		window.end = performance.now();
		console.log("Total time: " + (window.end - window.start) + " milliseconds.");
		resolve();
	});
}

$('#finallink').click(function() {
	var ssolink = finallink;
	shell.openExternal(ssolink);
});

// UPDATED: Crop button with unified progress
$('#cropbtn').click(function() {
	console.log('CROP BUTTON CLICKED - Starting pipelined de-id + upload');

	$('#confirm').hide();
	$('#home').hide();
	$('#preview').hide();
	$(this).hide();
	$('#manualbtn').hide();
	croppedfilelist = [];

	// Auth token required for upload
	var currentToken = checkToken();
	if (!currentToken) {
		$('#uploaderrors').html('No authentication token. Please restart the app and log in again.').show();
		return;
	}

	// Build the upload URL once
	finallink = 'https://www.sonoclipshare.com/archive.php?&f=' + folder;
	var encodedTitle = title ? encodeURIComponent(title) : null;
	var uploadlink = encodedTitle
		? 'https://www.sonoclipshare.com/uploadapp5.php?&token=' + currentToken + '&t=' + encodedTitle + '&f=' + folder
		: 'https://www.sonoclipshare.com/uploadapp5.php?&f=' + folder + '&token=' + currentToken;
	console.log('Upload target:', (title ? 'NEW archive' : 'existing archive'), '| folder:', folder, '| clips:', filelist.length);

	// Show BOTH progress bars (de-id + upload) at once
	$('#progressmsg').html('① De-identifying scans (cropping + removing metadata)').show();
	$('#myProgress').removeClass('crop-complete').show();
	$('#progressmsgUL').html('② Uploading to SonoClipShare').show();
	$('#myProgressUL').removeClass('deidentifying progress-complete').addClass('uploading').show();
	$('#activefile').show();
	cropController = createSmoothProgress('myBar', 'label');
	progressController = createSmoothProgress('myBarUL', 'labelUL');
	cropController.jump(0);
	progressController.jump(0);

	// Totals: cropping measured in source clips; upload measured in output files
	var totalSources = filelist.length;
	// Per source: clip = mp4 + poster + sized thumbs; still = still + sized thumbs.
	var totalOutputs = 0;
	for (var t = 0; t < filelist.length; t++) {
		totalOutputs += (isclip(filelist[t]) ? 2 : 1) + THUMB_WIDTHS.length;
	}
	var transcodedSources = 0;
	var uploadedOutputs = 0;
	// Per-session, and deliberately NOT offset: this is the "NNN_" prefix, which
	// only orders the files within one request, and the server's parser wants
	// exactly three digits. The scan_id offset rides on the artifact basename
	// instead — see `nexti` in the transcode loop below.
	var uploadSeq = 0;
	var pipelineError = null;

	// ---- upload consumer: first job alone (creates archive), then N-parallel ----
	var UPLOAD_CONCURRENCY = 4;
	var jobQueue = [];
	var activeUploads = 0;
	var transcodeDone = false;
	var archiveCreated = false;
	var finished = false;

	function fail(err) {
		if (pipelineError) return;
		pipelineError = err;
		console.error('Pipeline error:', err);
		var msg = (err && err.message) ? err.message : String(err);
		$('#progressmsgUL').html('Upload failed: ' + msg);
		var bar = document.getElementById('myBarUL');
		if (bar) { bar.style.backgroundColor = '#ff4444'; }
		$('#uploaderrors').html('Upload failed: ' + msg).show();
	}

	function maybeFinish() {
		if (finished || pipelineError) return;
		if (transcodeDone && jobQueue.length === 0 && activeUploads === 0) {
			finished = true;
			cropController.setProgress(100);
			progressController.setProgress(100);
			$('#activefile').hide();
			$('#progressmsgUL').html('✓ Upload complete');
			// fill animates to 100, then fade to green
			setTimeout(function() { $('#myProgressUL').removeClass('uploading').addClass('progress-complete'); }, 320);
			// Let the 100% + green state stay visible before showing the archive link
			setTimeout(function() {
				progressend({ status: 'success', upload_id: folder, processed_files: totalOutputs, files: [], errors: [] })();
			}, 1500);
		}
	}

	function runJob(job, isFirst) {
		activeUploads++;
		var startSeq = uploadSeq;
		uploadSeq += job.length;
		postFilesToServer(job, uploadlink, startSeq)
			.then(function() {
				uploadedOutputs += job.length;
				progressController.setProgress(Math.min(100, uploadedOutputs / totalOutputs * 100));
				job.forEach(function(f) { try { if (fs.existsSync(f)) { fs.unlink(f, function() {}); } } catch (e) {} });
				activeUploads--;
				if (isFirst) { archiveCreated = true; }
				pump();
				maybeFinish();
			})
			.catch(function(err) {
				activeUploads--;
				fail(err);
			});
	}

	function pump() {
		if (pipelineError) return;
		if (!archiveCreated) {
			// Serialize the first upload so the archive is created exactly once
			if (activeUploads === 0 && jobQueue.length > 0) { runJob(jobQueue.shift(), true); }
			return;
		}
		while (activeUploads < UPLOAD_CONCURRENCY && jobQueue.length > 0) {
			runJob(jobQueue.shift(), false);
		}
	}

	function enqueueUpload(files) {
		jobQueue.push(files);
		pump();
	}

	// ---- transcode pipeline: sequential, in order; feeds the upload queue ----
	var chain = Promise.resolve();
	filelist.forEach(function(srcFile, i) {
		chain = chain.then(function() {
			if (pipelineError) return;
			// THIS number becomes the scan_id. uploadapp5.php parses
			// "NNN_<n>.<rest>" and takes <n> — the artifact basename, not the
			// NNN ordering prefix — so continuing an existing archive means
			// starting <n> after its highest scan.
			//
			// existingScanOffset is the LAST id already used, so the first file
			// of a session takes offset + 1. A new archive leaves it at 0,
			// giving 1, 2, 3… exactly as before. Note this is NOT the API's
			// `next_scan`, which is one higher; the conversion is where the
			// picker sets this, and doing it here instead would make a new
			// archive start at 0.
			//
			// Restarting at 1 instead is what overwrote 001.mp4 and inserted a
			// duplicate scans row on every append — harmless-looking on your
			// own archive, and destroying somebody else's media on a shared one.
			var nexti = existingScanOffset + i + 1;
			var croppixel = croppixelarr[i];
			var cropvftext;
			if (!window.cropW) {
				cropvftext = 'crop=in_w:in_h-' + croppixel + ':0:' + croppixel + ',setsar=1,scale=800:-2';
			} else {
				var cw = Math.round(widtharr[i] * window.cropW);
				var ch = Math.round(heightarr[i] * window.cropH);
				var cx = Math.round(widtharr[i] * window.cropX);
				var cy = Math.round(heightarr[i] * window.cropY);
				cropvftext = 'crop=' + cw + ':' + ch + ':' + cx + ':' + cy + ',setsar=1,scale=800:-2';
			}
			$('#activefile').html(srcFile.replace(/^.*[\\\/]/, ''));

			if (isclip(srcFile)) {
				var outfile = path.join(workdir, nexti + '.mp4');
				var thumbnailfile = path.join(workdir, nexti + '.jpg');
				croppedfilelist.push(outfile, thumbnailfile);
				return ffmpeg.processVideo(srcFile, outfile, cropvftext, { preset: 'medium', crf: '20' })
					.then(function() { return ffmpeg.createThumbnail(outfile, thumbnailfile); })
					.then(function() { return makeSizedThumbs(thumbnailfile, nexti); })
					.then(function(sizedThumbs) {
						transcodedSources++;
						cropController.setProgress(Math.min(100, transcodedSources / totalSources * 100));
						enqueueUpload([outfile, thumbnailfile].concat(sizedThumbs));
					});
			} else {
				var stillfile = path.join(workdir, nexti + '.still.jpg');
				croppedfilelist.push(stillfile);
				return ffmpeg.processImage(srcFile, stillfile, cropvftext + ',setsar=1')
					.then(function() { return makeSizedThumbs(stillfile, nexti); })
					.then(function(sizedThumbs) {
						transcodedSources++;
						cropController.setProgress(Math.min(100, transcodedSources / totalSources * 100));
						enqueueUpload([stillfile].concat(sizedThumbs));
					});
			}
		});
	});

	// Clean up preview pngs
	for (var j = 1; j < previewindex + 1; j++) {
		for (var k = 0; k < filelist.length; k++) {
			var delfile = path.join(workdir, (k + 1) + '.' + j + '.png');
			if (fs.existsSync(delfile)) { fs.unlink(delfile, function() {}); }
		}
	}

	window.start = performance.now();
	chain.then(function() {
		if (pipelineError) return;
		cropController.setProgress(100);
		$('#progressmsg').html('✓ De-identification complete');
		$('#activefile').hide();
		// fill animates to 100, then fade to green
		setTimeout(function() { $('#myProgress').addClass('crop-complete'); }, 320);
		transcodeDone = true;
		maybeFinish();
	}).catch(function(error) {
		fail(error);
	});
});

function preview() {
	var myqueue = [];
	previewindex = previewindex + 1;
	$('#img-grid').html('');

	widtharr = [];
	heightarr = [];
	croppixelarr = [];
	
	var processFile = function(index) {
		return function() {
			return new Promise(function(resolve, reject) {
				if (index >= filelist.length) {
					resolve();
					return;
				}
				
				ffmpeg.probe(filelist[index])
					.then(function(metadata) {
						const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
						if (!videoStream) {
							$('#croplist').append(filelist[index] + ' has no video stream<br>');
							filelist.splice(index, 1);
							resolve();
							return;
						}
						
						const width = videoStream.width;
						const height = videoStream.height;
						
						if (isstill(filelist[index]) && (width < 50 || height < 50)) {
							$('#croplist').append(filelist[index] + ' was removed because it was a tiny image<br>');
							filelist.splice(index, 1);
							resolve();
							return;
						}
						
						var outfile = path.join(workdir, (index + 1) + '.' + previewindex + '.png');
						var croppixel = 2 * Math.round(height * window.croppixelperc / 2);
						
						widtharr[index] = width;
						heightarr[index] = height;
						croppixelarr[index] = croppixel;
						
						var cropvftext;
						if (!window.cropW) {
							cropvftext = 'crop=in_w:in_h-' + croppixel + ':0:' + croppixel + ',setsar=1,scale=650:-1';
						} else {
							var cropWidth = Math.round(width * window.cropW);
							var cropHeight = Math.round(height * window.cropH);
							var cropXstart = Math.round(width * window.cropX);
							var cropYstart = Math.round(height * window.cropY);
							cropvftext = 'crop=' + cropWidth + ':' + cropHeight + ':' + cropXstart + ':' + cropYstart + ',setsar=1,scale=650:-1';
						}
						
						return ffmpeg.generatePreview(filelist[index], outfile, cropvftext);
					})
					.then(function() {
						return previewdump(index + 1)();
					})
					.then(function() {
						resolve();
					})
					.catch(function(err) {
						console.error(`Preview generation error:`, err.message);
						$('#croplist').append(filelist[index] + ' failed to generate preview<br>');
						resolve();
					});
			});
		};
	};
	
	for (var i = 0; i < filelist.length; i++) {
		myqueue.push(processFile(i));
	}
	
	$('#loading-container').hide();
	$('#preview').show();
	$('#previewsize').show();
	$('#previewsizetext').show();
	myqueue.push(showbtns());
	
	queue(myqueue).then(function() {
		console.log('Preview generation completed');
	}).catch(function(err) {
		console.log('Preview error:', err);
	});
}

function previewdump(i) {
	return function() {
		return new Promise(function(resolve, reject) {
			var outfile = path.join(workdir, i + '.' + previewindex + '.png');
			
			var originalWidth = widtharr[i - 1];
			var originalHeight = heightarr[i - 1];
			var croppixel = croppixelarr[i - 1];
			
			var croppedHeight = originalHeight - croppixel;
			var aspectRatio = originalWidth / croppedHeight;
			
			var maxWidth = 300;
			var previewWidth = Math.min(maxWidth, originalWidth);
			var previewHeight = Math.round(previewWidth / aspectRatio);
			
			var imagehtml = '<div class="previewimg"><img src="' + outfile + '" width="' + previewWidth + 'px" height="' + previewHeight + 'px" style="object-fit: contain;"></img></div>';
			$('#img-grid').append(imagehtml);
			resolve(i);
		});
	};
}

$('#manualbtn').click(function() {
	window.draw = 1;
	$('#preview').hide();
	
	canvasbg(filelist).then(function(metadata) {
		const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
		const width = videoStream.width;
		const height = videoStream.height;
		canvasaspect = height / width;
		
		var time = new Date().toLocaleString();
		var timestamp = encodeURI(time);
		$('#myCanvas').css("background-image", "url(" + previewfile + "?" + timestamp + ")");

		// AS LARGE AS THE WINDOW ALLOWS, keeping the frame's aspect.
		//
		// This was a flat 500px wide, so the thing you have to draw an accurate
		// crop box on occupied about a third of the window while most of it sat
		// empty. Fitted to both axes now: 900 wide unless that would make it
		// taller than the space between the header and the caption + OK button,
		// in which case the height leads.
		//
		// Safe to resize at all because the crop is recorded as a FRACTION of
		// the canvas (cropselect.v2.js) and applied to the source video's own
		// dimensions -- the canvas is a ruler, not a coordinate system. What it
		// does require is that the frame fill the canvas exactly, which is what
		// `background-size: 100% 100%` in style.css guarantees.
		var CROP_MAX_W = 900;
		// 232 = 88 above (header) + ~144 below (caption, gap, and the OK button
		// fixed at bottom:30px).
		var cropMaxH = Math.max(240, window.innerHeight - 232);

		var cropW = CROP_MAX_W;
		var cropH = Math.round(CROP_MAX_W * canvasaspect);
		if (cropH > cropMaxH) {
			cropH = cropMaxH;
			cropW = Math.round(cropMaxH / canvasaspect);
		}

		$('#myCanvas').attr('width', cropW).attr('height', cropH);
		$('#canvaswrap').css('width', cropW + 'px');
		canvasheight = cropH;
		$('#canvaswrap').fadeIn();
		$('#highlight').fadeIn();
		$('#manualOKbtn').fadeIn();
		$('#manualbtn').hide();
		$('#cropbtn').hide();
		$('#confirm').hide();
	}).catch(function(err) {
		console.error('Error generating canvas background:', err);
	});
});

$('#manualOKbtn').click(function() {
	$(this).hide();
	$('#canvaswrap').hide();
	$('#highlight').hide();
	$('#loading-container').show();
	setTimeout(function() {
		preview(window.croppixelperc);
		$('#preview').show();
		$('#loading-container').hide();
		setcropvars();
	}, 10);
});

function addfilestatus() {
	var clipnum = 0;
	var stillnum = 0;
	for (var i = 0; i < filelist.length; i++) {
		if (isclip(filelist[i])) {
			clipnum = clipnum + 1;
		}
		if (isstill(filelist[i])) {
			stillnum = stillnum + 1;
		}
	}
	$('#addfilestatus').html(clipnum + ' clips, ' + stillnum + ' stills added');
	$('#addfilestatus').show();
}

// ---- "a newer version is available" -----------------------------------------
//
// The Auth0 login page used to do this: it read the app version out of the
// User-Agent the app set on the embedded auth window and compared it against
// appversion.php. Moving sign-in to the user's browser kills that -- the
// browser sends its own UA -- and it was always an odd place for the check,
// since it only ran at sign-in and depended on a page hosted in the Auth0
// dashboard.
//
// The app knows its own version, and appversion.php is public and CORS-enabled
// (GET -> {"version":"x.y.z"}), written by the release workflow. So it asks
// directly. Nothing here depends on how the user signed in.

var APPVERSION_ENDPOINT = 'https://www.sonoclipshare.com/appversion.php';
var DOWNLOAD_PAGE = 'https://github.com/uotw/SonoClipShareUploader#download';

// Numeric, part by part: "2.10.0" is NEWER than "2.9.0", which a string
// comparison gets backwards. Non-numeric or short versions compare as 0.
function isNewerVersion(candidate, current) {
	var a = String(candidate || '').split('.');
	var b = String(current || '').split('.');
	for (var i = 0; i < Math.max(a.length, b.length); i++) {
		var x = parseInt(a[i], 10) || 0;
		var y = parseInt(b[i], 10) || 0;
		if (x !== y) { return x > y; }
	}
	return false;
}

function checkForNewVersion() {
	$.ajax({ url: APPVERSION_ENDPOINT, dataType: 'json', cache: false, timeout: 8000 })
		.done(function (data) {
			var latest = data && data.version;
			if (!latest || !isNewerVersion(latest, version)) { return; }

			$('#updatetext').text('Version ' + latest + ' is available — you have ' + version + '.');
			$('#updatebanner').fadeIn();
		})
		.fail(function (xhr, status) {
			// Silent by design. Not knowing whether an update exists must never
			// interrupt someone about to upload a study; the version in the
			// corner is still correct either way.
			console.warn('Version check skipped:', status);
		});
}

$('#updatelink').click(function () {
	shell.openExternal(DOWNLOAD_PAGE);
});

// The updater got there first: it has already downloaded the new version in
// the background, so there is nothing to go and fetch. The message says WHEN it
// lands rather than offering a restart button, because this app can be halfway
// through de-identifying and uploading a study and no update is worth
// interrupting that. main.js installs it on quit.
ipcRenderer.on('update-downloaded', function (event, newVersion) {
	$('#updatetext').text('Version ' + (newVersion || 'update') +
		' downloaded — it will install when you quit.');
	$('#updatelink').hide();
	$('#updatebanner').fadeIn();
});

checkForNewVersion();

// Warm the picker's cache shortly after the app is up, so the first click on
// "Add to an existing Archive" paints immediately. Deliberately after startup:
// the first upload of a session matters more than this does.
setTimeout(warmArchiveCache, 1500);

// ---- theme ------------------------------------------------------------------
//
// Two themes, dark by default. The values live in css/themes.css: dark is
// :root, classic is [data-theme="classic"] -- so the attribute is only ever
// SET, never cleared to mean dark, and a window with no script at all still
// paints dark.
//
// The choice is local to this app (electron-store, beside the crop settings)
// rather than read from users.web_theme on the site. It has to survive being
// signed out and offline, which is most of the time before an upload starts.
//
// index.html applies the stored value in <head>, before the first paint. This
// only handles changing it.

function currentTheme() {
	return document.documentElement.getAttribute('data-theme') === 'classic' ? 'classic' : 'dark';
}

/**
 * @param persist  write the choice to disk. FALSE on load.
 *
 * Writing on load made the stored value self-perpetuating: the <head> script
 * reads it, the DOM reflects it, this reads the DOM back and writes it again.
 * A preference set once could then never lapse, and "no preference" -- the
 * state where dark is simply the default -- became unreachable after the first
 * launch. Now only an actual click writes.
 */
function applyTheme(theme, persist) {
	var classic = (theme === 'classic');

	if (classic) {
		document.documentElement.setAttribute('data-theme', 'classic');
	} else {
		document.documentElement.removeAttribute('data-theme');
	}

	// The icon shows what a click GIVES you, not what you are looking at --
	// the same way the website's nav toggle reads. Font Awesome, like every
	// other icon in the app; the class carries the glyph.
	$('#themetoggle')
		.attr('class', 'fa-solid ' + (classic ? 'fa-moon' : 'fa-sun'))
		.attr('title', classic ? 'Switch to dark' : 'Switch to classic (light)');

	try {
		if (persist) {
			store.set('theme', classic ? 'classic' : 'dark');
		}
		// The title bar and traffic lights are native and cannot be reached from
		// CSS -- main.js repaints them.
		ipcRenderer.send('theme-changed');
	} catch (e) {
		// A preference that cannot be written is worth a line in the console
		// and nothing more; the window is already showing the right thing.
		console.warn('Could not save theme preference:', e.message);
	}
}

$('#signout').click(function () {
	// main.js clears the stored credential and relaunches, so this lands back
	// on the sign-in screen rather than in a half-signed-out app.
	ipcRenderer.send('sign-out');
});

$('#themetoggle').click(function () {
	applyTheme(currentTheme() === 'classic' ? 'dark' : 'classic', true);
});

// Sets the glyph and title to match whatever <head> already applied. Does NOT
// persist -- see applyTheme().
applyTheme(currentTheme(), false);

// ---- "add to an existing Archive" picker ------------------------------------
//
// Backed by THE API -- the same my-archives and shared-archives endpoints the
// phone app and the website's own upload picker already use. An earlier draft
// added a new webroot endpoint (archivesapp.php) for this; it was dropped
// because the API already answers exactly this question, with server-side
// search, paging and sorting tuned for the heaviest accounts (1,589 archives
// owned, 10,269 shared). One definition of "archives I can upload to", shared
// by all three clients.
//
// UPLOADS ARE UNAFFECTED and still go to uploadapp5.php. That endpoint exists
// precisely because this app crops, strips metadata and encodes CLIENT-SIDE
// and uploads finished artifacts: it does NO transcoding, unlike uploadCuda
// and the API's own upload-media, which re-encode everything they receive.
// Consolidating onto cuda was tried and abandoned on 2026-07-31 for that
// reason -- pure waste and a quality loss. Only the LISTING moved.
//
// AUTH DIFFERS BETWEEN THE TWO. The API needs `Authorization: Bearer <API
// access token>`; uploadapp5 needs `?token=<ID token>`. One sign-in yields
// both -- see getAuthConfig() in main.js.
//
// The picker carries `next_scan` through to the upload. uploadapp5.php takes
// scan_id straight from the NNN_ filename prefix, so appending to an archive
// that already has 7 scans while numbering from 001 overwrites 001.mp4 and
// duplicates its scans row. See uploadSeq in the upload handler.

var API_ENDPOINT = 'https://www.sonoclipshare.com/api/v1/mobile.php';
var PICKER_PAGE_SIZE = 30;

var selectedArchive = null;    // the row the user picked, or null
var existingScanOffset = 0;    // where this upload's NNN_ prefixes start

var picker = {
	q: '',
	scope: 'all',
	total: 0,
	loaded: 0,
	loading: false,
	searchTimer: null,
	// Retires in-flight responses when the search or scope changes. Replaces
	// the single `req` handle, which could only abort one of the two requests
	// the merge now issues.
	seq: 0,
	// One cursor per source; the merge pulls from whichever has the newer head.
	src: {
		mine:   { page: 0, done: false, buf: [], total: 0, error: null },
		shared: { page: 0, done: false, buf: [], total: 0, error: null }
	}
};

function esc(s) {
	return String(s === null || s === undefined ? '' : s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// "2026-08-01 14:22:05" -> "Aug 1, 2026". Parsed as local time (the T form is
// what Chromium wants; the bare space form is implementation-defined).
function prettyDate(mysqlDate) {
	if (!mysqlDate) { return ''; }
	var d = new Date(String(mysqlDate).replace(' ', 'T'));
	if (isNaN(d.getTime())) { return String(mysqlDate); }
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function countsLabel(a) {
	var parts = [];
	if (a.mp4) { parts.push(a.mp4 + (a.mp4 === 1 ? ' clip' : ' clips')); }
	if (a.jpg) { parts.push(a.jpg + (a.jpg === 1 ? ' still' : ' stills')); }
	return parts.length ? parts.join(', ') : 'empty';
}

function ownerLabel(a) {
	if (a.scope !== 'shared') { return ''; }
	return 'Shared by ' + (a.owner_name || a.owner_email || 'someone else');
}

function archiveRow(a) {
	var thumb = a.thumb
		? '<div class="athumb" style="background-image:url(\'' + esc(a.thumb) + '\')"></div>'
		: '<div class="athumb is-empty"></div>';
	var badge = a.scope === 'shared'
		? '<div class="abadge is-shared">' + esc(ownerLabel(a)) + '</div>'
		: '';

	return $('<div class="arow"></div>')
		.attr('data-folder', a.folder)
		.data('archive', a)
		.html(
			thumb +
			'<div class="ameta">' +
				'<div class="atitle">' + esc(a.title || '(untitled)') + '</div>' +
				'<div class="asub">' + esc(prettyDate(a.date)) + ' &middot; ' + esc(countsLabel(a)) + '</div>' +
			'</div>' +
			badge
		);
}

function setPickerStatus(text) {
	$('#archivestatus').text(text || '');
}

function selectArchiveRow($row) {
	$('#archivelist .arow').removeClass('is-selected');
	if (!$row || !$row.length) {
		selectedArchive = null;
		$('#okselect').prop('disabled', true);
		return;
	}
	$row.addClass('is-selected');
	selectedArchive = $row.data('archive');
	$('#okselect').prop('disabled', false);

	// Keep the selection visible when it moved by keyboard.
	var el = $row[0];
	if (el && el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); }
}

// One API row -> the shape archiveRow()/countsLabel()/ownerLabel() already
// render. Kept as an adapter rather than rewriting the renderers, so the only
// thing that changed is where the data comes from.
function normalizeArchive(kind, r) {
	var counts = r.media_count || {};
	var by = r.shared_by || {};
	return {
		folder: r.id,
		title: r.title,
		// my-archives calls it `created`, shared-archives `updated`; both are
		// archives.ts_update, so the merge below compares like with like.
		date: kind === 'mine' ? r.created : r.updated,
		mp4: counts.videos || 0,
		jpg: counts.images || 0,
		thumb: r.thumbnail_url || null,
		scope: kind === 'mine' ? 'mine' : 'shared',
		owner_name: kind === 'shared' ? (by.name || null) : null,
		owner_email: kind === 'shared' ? (by.email || null) : null,
		// Added to both endpoints for this client. Absent = an older server;
		// 0 then makes the upload number from 001, which is the old behaviour
		// rather than a crash.
		next_scan: r.next_scan || 0
	};
}

function pickerKinds() {
	if (picker.scope === 'mine') { return ['mine']; }
	if (picker.scope === 'shared') { return ['shared']; }
	return ['mine', 'shared'];
}

function archiveDateValue(row) {
	var t = Date.parse(String(row && row.date || '').replace(' ', 'T'));
	return isNaN(t) ? 0 : t;
}

// ---- the warm cache ---------------------------------------------------------
//
// The first page of each source, fetched shortly after the app opens, so the
// picker paints instantly instead of showing a spinner for a round trip.
//
// FIVE MINUTES, and the number is not arbitrary: the API signs thumbnail URLs
// with a 1800-second TTL (buildSecureLink). Serve a cache older than that and
// every tile 403s -- a picker full of broken images, which is worse than the
// spinner this replaces. Five minutes leaves a wide margin.
//
// ONLY page 1 of an empty search is cached. That is the state the picker opens
// in; searches and later pages always go to the network, where being current
// matters more and there is nothing to make instant anyway.
var PREFETCH_TTL_MS = 5 * 60 * 1000;
var prefetch = { mine: null, shared: null };

function parseArchivePage(kind, response) {
	var d = (response && response.data) ? response.data : response;
	var rows = (d && d.archives) || [];
	var pag = (d && d.pagination) || {};
	return {
		rows: rows.map(function(r) { return normalizeArchive(kind, r); }),
		page: pag.page || 1,
		total: typeof pag.total === 'number' ? pag.total : rows.length,
		totalPages: pag.total_pages || null
	};
}

function requestArchivePage(kind, page, search) {
	return $.ajax({
		cache: false,
		url: API_ENDPOINT,
		dataType: 'json',
		type: 'GET',
		headers: { Authorization: 'Bearer ' + checkApiToken() },
		data: {
			endpoint: kind === 'mine' ? 'my-archives' : 'shared-archives',
			page: page,
			limit: PICKER_PAGE_SIZE,
			search: search
		}
	}).then(function(response) { return parseArchivePage(kind, response); });
}

function freshPrefetch(kind) {
	var c = prefetch[kind];
	return (c && (Date.now() - c.at) < PREFETCH_TTL_MS) ? c.data : null;
}

// Warm both sources. Silent on failure by design: this is speculative work the
// user did not ask for, it fails transiently (asleep, captive wifi), and the
// picker reports properly when a fetch the user IS waiting on fails.
function warmArchiveCache() {
	if (!checkApiToken()) { return; }
	['mine', 'shared'].forEach(function(kind) {
		requestArchivePage(kind, 1, '').then(function(parsed) {
			prefetch[kind] = { at: Date.now(), data: parsed };
		}, function() { /* silent */ });
	});
}

function applyPage(s, parsed) {
	s.page = parsed.page;
	s.total = parsed.total;
	parsed.rows.forEach(function(r) { s.buf.push(r); });
	if (!parsed.rows.length || (parsed.totalPages && s.page >= parsed.totalPages)) {
		s.done = true;
	}
}

// Fetch the next page of one source into its buffer. Resolves either way --
// a failure marks that source done and records the error, so one dead source
// cannot wedge the merge.
function fillBuffer(kind, seq) {
	var s = picker.src[kind];
	if (s.buf.length || s.done) { return $.Deferred().resolve().promise(); }

	var page = s.page + 1;
	if (page === 1 && !picker.q) {
		var cached = freshPrefetch(kind);
		if (cached) {
			applyPage(s, cached);
			return $.Deferred().resolve().promise();
		}
	}

	return requestArchivePage(kind, page, picker.q).then(function(parsed) {
		if (seq !== picker.seq) { return; }          // superseded by a newer search
		applyPage(s, parsed);
		if (page === 1 && !picker.q) {
			prefetch[kind] = { at: Date.now(), data: parsed };
		}
	}, function(xhr) {
		if (seq !== picker.seq) { return; }
		s.done = true;
		s.error = xhr && xhr.status ? xhr.status : 'network';
		console.error('Archive list failed:', kind, s.error, xhr && xhr.responseText);
	});
}

// Emit up to `want` rows in date order across the active sources.
//
// A k-way merge rather than "fetch page N of both and concatenate": each
// source is date-descending on its own, but their pages interleave, so
// concatenating would put a 2019 archive of yours above one shared with you
// yesterday. Pull from whichever source currently has the newer head, topping
// up a buffer only when it runs dry.
function emitMerged(want, seq) {
	var out = [];
	function step() {
		if (seq !== picker.seq || out.length >= want) {
			return $.Deferred().resolve(out).promise();
		}
		var kinds = pickerKinds();
		return $.when.apply($, kinds.map(function(k) { return fillBuffer(k, seq); }))
			.then(function() {
				if (seq !== picker.seq) { return out; }
				var bestKind = null;
				kinds.forEach(function(k) {
					if (!picker.src[k].buf.length) { return; }
					if (bestKind === null ||
						archiveDateValue(picker.src[k].buf[0]) >
						archiveDateValue(picker.src[bestKind].buf[0])) {
						bestKind = k;
					}
				});
				if (bestKind === null) { return out; }    // every source exhausted
				out.push(picker.src[bestKind].buf.shift());
				return step();
			});
	}
	return step();
}

// Load one page. reset = start over (new search or scope).
function loadArchives(reset) {
	if (!checkApiToken()) {
		setPickerStatus('Not signed in — restart the app and log in again.');
		return;
	}
	if (picker.loading && !reset) { return; }

	if (reset) {
		// Bumping the sequence retires every in-flight request instead of
		// aborting it: two sources means two requests, and an abort on one
		// used to leave the other's response to land on a cleared list.
		picker.seq++;
		picker.loaded = 0;
		picker.src = {
			mine:   { page: 0, done: false, buf: [], total: 0, error: null },
			shared: { page: 0, done: false, buf: [], total: 0, error: null }
		};
		$('#archivelist').empty().scrollTop(0);
		selectArchiveRow(null);
	}

	var seq = picker.seq;
	picker.loading = true;
	$('#pickerrefresh').addClass('is-spinning');
	setPickerStatus(picker.loaded === 0 ? 'Loading archives…' : 'Loading more…');

	// One settle point is enough: emitMerged always resolves. fillBuffer turns a
	// failed source into "done, with an error" rather than a rejection, so one
	// dead endpoint cannot leave the spinner running forever.
	emitMerged(PICKER_PAGE_SIZE, seq).then(function(rows) {
		if (seq !== picker.seq) { return; }
		picker.loading = false;
		$('#pickerrefresh').removeClass('is-spinning');

		var $list = $('#archivelist');
		rows.forEach(function(a) { $list.append(archiveRow(a)); });
		picker.loaded += rows.length;

		var kinds = pickerKinds();
		var total = 0, failed = 0, exhausted = true;
		kinds.forEach(function(k) {
			total += picker.src[k].total;
			if (picker.src[k].error) { failed++; }
			if (!picker.src[k].done || picker.src[k].buf.length) { exhausted = false; }
		});
		picker.total = total;

		if (failed === kinds.length) {
			setPickerStatus(picker.src[kinds[0]].error === 401
				? 'Session expired — restart the app and log in again.'
				: 'Could not reach SonoClipShare. Check your connection and try again.');
			return;
		}
		if (picker.loaded === 0) {
			setPickerStatus(picker.q
				? 'No archives match “' + picker.q + '”.'
				: (picker.scope === 'shared'
					? 'Nobody has shared an archive with you yet.'
					: 'You have no archives yet — go back and create one.'));
		} else {
			setPickerStatus('Showing ' + picker.loaded + ' of ' + total +
				(exhausted ? '' : ' — scroll for more'));
		}
	});
}

function openArchivePicker() {
	picker.q = '';
	picker.scope = 'all';
	$('#archivesearch').val('');
	$('.scopetab').removeClass('is-active').filter('[data-scope="all"]').addClass('is-active');
	$('#addselect').fadeIn();
	$('#archivesearch').focus();
	loadArchives(true);

	// Refresh the CACHE in the background, not the visible list: rows shifting
	// under the cursor while someone is reading them is worse than being a few
	// minutes stale. The refresh button is there for when they want it now.
	warmArchiveCache();
}

$('#add').click(function() {
	$('#finallinkwrap').hide();
	$('#addornew').hide();
	openArchivePicker();
});

// Server-side search, so debounce rather than filter a list we don't fully have.
$('#archivesearch').on('input', function() {
	var value = $(this).val();
	clearTimeout(picker.searchTimer);
	picker.searchTimer = setTimeout(function() {
		picker.q = value.trim();
		loadArchives(true);
	}, 250);
});

$('.scopetab').click(function() {
	var scope = $(this).data('scope');
	if (scope === picker.scope) { return; }
	$('.scopetab').removeClass('is-active');
	$(this).addClass('is-active');
	picker.scope = scope;
	loadArchives(true);
});

// Force a trip to the server. Dropping the cache first is the point: without
// that, a refresh inside the cache window would repaint the same rows and look
// broken.
$('#pickerrefresh').click(function() {
	prefetch.mine = null;
	prefetch.shared = null;
	loadArchives(true);
});

$('#archivelist').on('scroll', function() {
	if (picker.loading || picker.loaded >= picker.total) { return; }
	var el = this;
	if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
		loadArchives(false);
	}
});

$('#archivelist').on('click', '.arow', function() {
	selectArchiveRow($(this));
});

$('#archivelist').on('dblclick', '.arow', function() {
	selectArchiveRow($(this));
	$('#okselect').click();
});

// Arrow keys move the selection without leaving the search box, so a search can
// be typed and its first hit chosen without touching the mouse.
$('#addselect').on('keydown', function(e) {
	if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') { return; }

	if (e.key === 'Enter') {
		if (selectedArchive) { $('#okselect').click(); }
		return;
	}

	e.preventDefault();
	var $rows = $('#archivelist .arow');
	if (!$rows.length) { return; }

	var index = $rows.index($rows.filter('.is-selected'));
	if (index < 0) {
		selectArchiveRow($rows.first());
		return;
	}
	var next = (e.key === 'ArrowDown') ? index + 1 : index - 1;
	if (next < 0 || next >= $rows.length) { return; }
	selectArchiveRow($rows.eq(next));
});

$('#new').click(function() {
	$('#thetitle').val('');
	$('#finallinkwrap').hide();
	$('#addornew').hide();
	$('#newtitle').fadeIn();
	$('#thetitle').focus();
});

$('#oktitle').click(function() {
	title = $('#thetitle').val();
	title = title.trim();
	folder = maketemp();
	if (title.length > 0) {
		selectedArchive = null;
		existingScanOffset = 0;   // a new archive starts at scan 001
		$('#addtarget').hide();
		$('#newtitle').hide();
		$('#filelistwrap').fadeIn();
		console.log("Creating archive with title/folder: " + title + '/' + folder);
	}
});

$('#okselect').click(function() {
	if (!selectedArchive) { return; }

	folder = selectedArchive.folder;
	title = null;   // no &t= — the archive already has one, and it isn't ours to change

	// Continue this archive's scan numbering instead of restarting at 001.
	// Without it the first clip overwrites 001.mp4 and inserts a duplicate
	// scans row — which on a shared archive means destroying someone else's
	// media. `next_scan` comes from the API listing; it counts soft-deleted
	// scans too, because a deleted row keeps its id AND its file on disk.
	//
	// MINUS ONE, because the two halves count differently. The API's
	// `next_scan` is the next id to USE (MAX(scan_id) + 1), while
	// existingScanOffset is the LAST id used — the transcode loop adds i + 1
	// to it, and a new archive sets it to 0 so the first file is 1. Feeding
	// the API's value in raw added the 1 twice: uploading into ByEDdH68yz,
	// whose highest id was 64, started the batch at 66 and skipped 65.
	//
	// Harmless as bugs go — one wasted id per session, no collision and no
	// overwrite, and ids in these archives are already non-contiguous — but
	// the field means what its name says, so the correction belongs here
	// rather than in a renamed contract.
	//
	// `|| 1` before the subtraction, not `|| 0`: a missing or zero value has
	// to land on offset 0 (first file = 1), not -1.
	existingScanOffset = (selectedArchive.next_scan || 1) - 1;

	var owner = ownerLabel(selectedArchive);
	$('#addtarget')
		.html('Adding to <b>' + esc(selectedArchive.title || '(untitled)') + '</b>' +
			(owner ? ' <span class="abadge is-shared">' + esc(owner) + '</span>' : ''))
		.show();

	console.log('Selected archive:', folder, '| scope:', selectedArchive.scope,
		'| continuing scan numbering from:', existingScanOffset);

	$('#addselect').hide();
	$('#filelistwrap').fadeIn();
});

$('#cancelselect').click(function() {
	$('#addselect').hide();
	$('#addornew').fadeIn();
});

// UPDATED: Home button with unified progress cleanup
$('#home').click(function() {
	// Stop both progress controllers
	if (cropController) {
		cropController.stop();
		cropController = null;
	}
	if (progressController) {
		progressController.stop();
		progressController = null;
	}
	$('#myProgress').hide();
	$('#progressmsg').hide();
	
	// Reset all UI elements
	$('#activefile').hide();
	$('#addornew').fadeIn();
	$('#addselect').hide();
	$('#canvaswrap').hide();
	$('#clearbtn').hide();
	$('#cropbtn').hide();
	$('#confirm').hide();
	$('#filelistwrap').hide();
	$('#finallinkwrap').hide();
	$('#highlight').hide();
	$('#loading-container').hide();
	$('#myProgressUL').hide();
	$('#newtitle').hide();
	$('#preview').hide();
	$('#previewbtn').hide();
	$('#progressmsgUL').hide();
	$('#uploadstatus').hide();
	$('#uploaderrors').hide();
	$('#manualbtn').hide();
	
	// Reset progress bar completely
	$('#myProgressUL').removeClass('uploading deidentifying processing progress-complete');
	var elem = document.getElementById("myBarUL");
	var label = document.getElementById("labelUL");
	if (elem && label) {
		elem.classList.remove('progress-complete');
		elem.style.width = "0%";
		elem.style.backgroundColor = "";
		label.innerHTML = "0%";
	}
	
	$('#addtarget').hide();

	// Reset variables
	filelist = [];
	croppedfilelist = [];
	uploadBatchId = null;
	title = null;
	folder = null;
	selectedArchive = null;
	existingScanOffset = 0;
	lastperc = 0;
	lastpercUL = 0;
	
	$('#filelist').html('');
	addfilestatus();
	$('#drag').css('visibility', 'visible');
});

// Canvas drawing functionality
var canvas = document.getElementById('myCanvas');
var ctx = canvas.getContext('2d');
var rect = {};
var drag = false;
var mouseX, mouseY;

function init() {
	canvas.addEventListener('mousedown', mouseDown, false);
	canvas.addEventListener('mouseup', mouseUp, false);
	canvas.addEventListener('mousemove', mouseMove, false);
}

function mouseDown(e) {
	if (window.draw == 1) {
		rect.startX = e.pageX - this.offsetLeft;
		rect.startY = e.pageY - this.offsetTop;
		drag = true;
	}
}

function mouseUp() {
	if (window.draw == 1) {
		drag = false;
		if (rect.w && rect.h) {
			var canvasWidth = canvas.width;
			var canvasHeight = canvas.height;
			
			window.cropX = rect.startX / canvasWidth;
			window.cropY = rect.startY / canvasHeight;
			window.cropW = rect.w / canvasWidth;
			window.cropH = rect.h / canvasHeight;
		}
	}
}

function mouseMove(e) {
	if (window.draw == 1 && drag) {
		mouseX = e.pageX - this.offsetLeft;
		mouseY = e.pageY - this.offsetTop;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		draw();
	}
}

function draw() {
	ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	rect.w = mouseX - rect.startX;
	rect.h = mouseY - rect.startY;
	
	ctx.clearRect(rect.startX, rect.startY, rect.w, rect.h);
	
	ctx.strokeStyle = '#00ff00';
	ctx.lineWidth = 2;
	ctx.strokeRect(rect.startX, rect.startY, rect.w, rect.h);
}

// Keyboard shortcuts
$(document).keydown(function(e) {
	if (e.keyCode === 27) {
		$('#home').click();
	}
	
	if (e.keyCode === 13) {
		if ($('#newtitle').is(':visible')) {
			$('#oktitle').click();
		} else if ($('#addselect').is(':visible')) {
			$('#okselect').click();
		} else if ($('#canvaswrap').is(':visible')) {
			$('#manualOKbtn').click();
		}
	}
	
	if (e.keyCode === 32 && $('#cropbtn').is(':visible')) {
		e.preventDefault();
		$('#cropbtn').click();
	}
});

// Error handling and cleanup
window.onerror = function(msg, url, lineNo, columnNo, error) {
	console.error('JavaScript Error:', {
		message: msg,
		source: url,
		line: lineNo,
		column: columnNo,
		error: error
	});
	
	if (msg.includes('token') || msg.includes('upload') || msg.includes('ffmpeg')) {
		$('#uploaderrors').html('An error occurred. Please try again or restart the application.');
		$('#uploaderrors').show();
	}
	
	return false;
};

window.addEventListener('beforeunload', function(e) {
	if (cropController) { cropController.stop(); }
	if (progressController) { progressController.stop(); }

	var uploading = $('#myProgressUL').is(':visible') && progressController && progressController.getCurrentProgress() < 100;
	var cropping = $('#myProgress').is(':visible') && cropController && cropController.getCurrentProgress() < 100;
	if (uploading || cropping) {
		e.preventDefault();
		e.returnValue = 'Processing in progress. Are you sure you want to close?';
		return e.returnValue;
	}
});

console.log('Renderer script loaded successfully');
console.log('Application version:', version);
console.log('Working directory:', workdir);
