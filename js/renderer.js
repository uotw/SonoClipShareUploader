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

// POST one job (a clip's mp4+thumbnail, or one still) to uploadapp4.php.
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
		$('#drag').css('visibility', 'visible');
		addfilestatus();
		$('#home').fadeIn();
		
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
		? 'https://www.sonoclipshare.com/uploadapp4.php?&token=' + currentToken + '&t=' + encodedTitle + '&f=' + folder
		: 'https://www.sonoclipshare.com/uploadapp4.php?&f=' + folder + '&token=' + currentToken;
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
	var totalOutputs = 0;
	for (var t = 0; t < filelist.length; t++) { totalOutputs += isclip(filelist[t]) ? 2 : 1; }
	var transcodedSources = 0;
	var uploadedOutputs = 0;
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
			var nexti = i + 1;
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
					.then(function() {
						transcodedSources++;
						cropController.setProgress(Math.min(100, transcodedSources / totalSources * 100));
						enqueueUpload([outfile, thumbnailfile]);
					});
			} else {
				var stillfile = path.join(workdir, nexti + '.still.jpg');
				croppedfilelist.push(stillfile);
				return ffmpeg.processImage(srcFile, stillfile, cropvftext + ',setsar=1')
					.then(function() {
						transcodedSources++;
						cropController.setProgress(Math.min(100, transcodedSources / totalSources * 100));
						enqueueUpload([stillfile]);
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
		canvasheight = 500 * canvasaspect;
		$('#myCanvas').attr('height', canvasheight);
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

$('#add').click(function() {
	$('#finallinkwrap').hide();
	$('#addornew').hide();
	loadmyarchives();
});

function loadmyarchives() {
	var currentToken = checkToken();
	if (!currentToken) {
		$('#loading-container').hide();
		alert('Authentication token not available. Please restart the app.');
		return;
	}
	
	$('#loading-text').hide();
	$('#loading-container').show();
	$('#myarchives').html('<option value="Select">Select</option>');
	var url = "https://www.sonoclipshare.com/myarchivesapp.php?&token=" + currentToken;
	
	$.ajax({
		cache: false,
		url: url,
		data: {},
		dataType: 'json',
		type: 'GET',
		async: true,
		success: function(response) {
			$('#loading-text').show();
			$('#loading-container').hide();
			if (response != null) {
				for (var item in response) {
					if (response.hasOwnProperty(item)) {
						var nextitem = 'archive#' + response[item].archive + ' , ' + response[item].date + ' , ' + response[item].title;
						var folder = response[item].folder;
						$('#myarchives').append('<option value=' + folder + '>' + nextitem + '</option>');
					}
				}
			} else {
				$('#newtitlemessage').html('Give your first Archive a title');
			}
			$('#addselect').fadeIn();
		},
		error: function() {
			console.log("ERROR w/ AJAX!");
		}
	});
}

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
		$('#newtitle').hide();
		$('#filelistwrap').fadeIn();
		console.log("Creating archive with title/folder: " + title + '/' + folder);
	}
});

$('#okselect').click(function() {
	folder = $('#myarchives').val();
	if (folder != 'Select') {
		$('#addselect').hide();
		$('#filelistwrap').fadeIn();
	}
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
	
	// Reset variables
	filelist = [];
	croppedfilelist = [];
	uploadBatchId = null;
	title = null;
	folder = null;
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
