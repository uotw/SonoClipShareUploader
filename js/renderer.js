const ffmpeg = require('@ffmpeg-installer/ffmpeg');
var ffmpegpath = ffmpeg.path;
const ffprobe = require('@ffprobe-installer/ffprobe');
var ffprobepath = ffprobe.path;
var remote = require('@electron/remote')
const {
	ipcRenderer
} = require('electron')
var version = remote.app.getVersion();
var $ = window.$ = window.jQuery = require('jquery');
const os = require('os');
const ostemp = os.tmpdir()
var request = require('request');
var axios = require('axios');
var FormData = require('form-data');

const Store = require('electron-store');
const store = new Store();
const arch = os.arch();

if (store.get('cropWidth')) {
    window.cropW = store.get('cropWidth');
    window.cropH = store.get('cropHeight');
    window.cropX = store.get('cropXstart');
    window.cropY = store.get('cropYstart');
}

const {
	shell
} = require('electron');
const spawn = require('cross-spawn');
const spawnsync = spawn.sync;

var filelist = [];
var widtharr = [];
var heightarr = [];
var croppixelarr = [];
var canvasaspect;
var path = require('path');
workdir = path.join(ostemp,maketemp())
remote.getGlobal('workdirObj').prop1 = workdir;
var id_token = remote.getGlobal('token').thetoken;

console.log('tempdir: ' + remote.getGlobal('workdirObj').prop1);
var previewfile = path.join(workdir,'preview.png');
previewfile=previewfile.split(path.sep).join(path.posix.sep);
//var previewfile=previewfile.split(path.sep).join(path.win32.sep);
var previewindex = 0;
var lastperc = 0;
var lastpercUL = 0;
var fs = require('fs');

var croppedfilelist = [];
var title, folder, finallink;
var ispreviewclip = 1;
window.croppixelperc = 0.09;
// const spawn = require('child_process').spawn;
//const spawnsync = require('child_process').spawnSync;

// ************ AXIOS START ************ //
// AXIOS END
function maketemp() {
	var text = "";
	var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (var i = 0; i < 10; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
	return text;
}

function run_cmd(cmd, args, callBack) {
	var spawn = require('child_process').spawn;
	var child = spawn(cmd, args);
	var resp = "";
	child.stdout.on('data', function(buffer) {
		resp += buffer.toString()
	});
	child.stdout.on('end', function() {
		callBack(resp)
	});
} // ()
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
			list_temp = search(filename); //recurse
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
//allow drop on dahsed area
$("#filelistwrap").on('dragenter', function(event) {
	event.stopPropagation();
	event.preventDefault();
});
$("#filelistwrap").on('dragover', function(event) {
	event.stopPropagation();
	event.preventDefault();
});
$("#filelistwrap").on('drop', function(event) {
	// spawn(appswitchpath, ['-p', pid]);
	ipcRenderer.send('focusnow', 'focus')
	event.preventDefault();
	var path = require('path');
	var files = event.originalEvent.dataTransfer.files;
	for (var i = 0; i < files.length; i++) {
		name = files[i].name;
		path = files[i].path;
		if (fs.lstatSync(path).isDirectory()) {
			var temp_list = [];
			temp_list = search(path);
			for (var k = 0; k < temp_list.length; k++) {
				if (filelist.indexOf(temp_list[k]) == -1) {
					filelist.push(temp_list[k]);
					var index = filelist.length;
					$('#filelist').append(index + ': ' + temp_list[k] + '<br />');
				}
			}
		} else if (isstill(name) || isclip(name)) {
			if (filelist.indexOf(path) == -1) {
				filelist.push(path);
				var index = filelist.length;
				$('#filelist').append(index + ': ' + path + '<br />');
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
//prevent ‘drop’ event on document.
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
        ffmpegBG = spawnsync(ffmpegpath, ['-i', filelist[0], '-an', '-vf', 'scale=500:-1', '-pix_fmt', 'rgb24', '-vframes', '1', '-f', 'image2', '-map_metadata', '-1', '-y', previewfile]);
        ffprobeBG = spawnsync(ffprobepath, ['-print_format', 'json', '-show_streams', '-i', filelist[0]]);
    	ffprobeOb = JSON.parse(ffprobeBG.stdout);
    return (ffprobeOb);

}
$('#previewbtn').click(function() { //Generate page of 9% cropped thumbnails to preview
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
    //console.log(window.cropW, window.cropH, window.cropX, window.cropY);
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

function customSpawn(command, args) {
	return () => new Promise((resolve, reject) => {
		console.log(command + args.join(" "));
		const child = spawn(command, args);
		child.stdout.on('data', (data) => {
			console.log(`stdout: ${data}`);
		});
		child.stderr.on('data', (data) => {
			console.log(command + args + `stderr: ${data}`);
		});
		child.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject();
			}
		});
	});
}

function progress(i) {
	return () => new Promise((resolve, reject) => {
		stop = Math.round(100 * (i + 1) / filelist.length);
		var elem = document.getElementById("myBar");
		start = lastperc;
		var width = start;
		//$('#myBar').animate({width:stop+'%'});
		var id = setInterval(frame, 2);

		function frame() {
			if (width >= stop) {
				clearInterval(id);
				resolve(i);
				if (i + 1 == croppedfilelist.length) {
					elem.style.width = "100%";
					$('#myBar').css('width', '100%');
					document.getElementById("label").innerHTML = "100%";
					$('#activefile').hide();
					$('#myProgressUL').show();
					$('#progressmsgUL').show();
					$('#progressmsg').hide();
					$('#myProgress').hide();
					lastperc = 0;
				}
			} else {
				width++;
				elem.style.width = width + '%';
				document.getElementById("label").innerHTML = width * 1 + '%';
			}
		}
		lastperc = stop;
		if (i < filelist.length - 1) {
			var filename = filelist[i + 1].replace(/^.*[\\\/]/, '')
			$('#activefile').html(filename);
		}
	});
}

function progressUL(i) {
	return () => new Promise((resolve, reject) => {
		stop = Math.round(100 * (i + 1) / croppedfilelist.length);
		var elem = document.getElementById("myBarUL");
		start = lastpercUL;
		var width = start;
		//$('#myBar').animate({width:stop+'%'});
		var id = setInterval(frame, 1);

		function frame() {
			if (width >= stop) {
				if (i + 1 == croppedfilelist.length) {
					lastpercUL = 0;
				}
				clearInterval(id);
				resolve(i);
			} else {
				width++;
				elem.style.width = width + '%';
				document.getElementById("labelUL").innerHTML = width * 1 + '%';
			}
		}
		lastpercUL = stop;
		if (i < croppedfilelist.length - 1) {
			var filename = croppedfilelist[i + 1].replace(/^.*[\\\/]/, '')
			console.log("uploading" + croppedfilelist[i + 1]);
			//$('#activefileUL').html(filename);
		}
		//resolve(i);
	});
}

function progressend(i) {
	return () => new Promise((resolve, reject) => {
		$('#myProgressUL').hide();
		$('#progressmsgUL').hide();
		$('#finallink').html(finallink);
		//$('#finallink').attr('href',finallink);
		$('#finallinkwrap').fadeIn();
		$('#addornew').fadeIn();

		filelist = [];
		$('#filelist').html('');
		$('#drag').css('visibility', 'visible');
		addfilestatus();
		$('#home').fadeIn();
		$('#myBar').css('width', '0');
		document.getElementById("label").innerHTML = "0%";
		$('#myBarUL').css('width', '0');
		document.getElementById("labelUL").innerHTML = "0%";
		window.end = performance.now();
		// console.log("Call to doSomething took " + (window.end - window.start) + " milliseconds.")

		//console.log('finished');
		resolve(i);
	});
}
$('#finallink').click(function() {
	var ssolink = finallink;
	//var ssolink = 'https://ultrasoundjelly.auth0.com/authorize?response_type=code&client_id=Ei2ZzdG8T1pSHElwiIsZgTS6zY0vemv6&redirect_uri=' + encodeURIComponent(finallink);

	//https://www.sonoclipshare.com/myarchives.php&showSignup=false';
	shell.openExternal(ssolink);
});
$('#cropbtn').click(function() { //SET UP CROPPING TASKS AND DO IT!
	$('#confirm').hide();
	$('#home').hide();
	var myqueue = [];
	croppedfilelist = [];
	$('#myProgress').show();
	$('#preview').hide();
	$(this).hide();
	$('#manualbtn').hide();
	$('#progressmsg').show();
	$('#activefile').show();
	var filename = filelist[0].replace(/^.*[\\\/]/, '')
	$('#activefile').html(filename);
	//BUILD CROP AND DIM ARRAY
	for (var i = 0; i < filelist.length; i++) {
		nexti = i + 1;
		var croppath = path.dirname(filelist[i]);
	        //console.log("PATH: " + croppath);
	        var basename = path.basename(filelist[i]);
	        var ext = basename.split('.');
	        ext = '.' + ext[ext.length - 1];
	        basename = path.basename(filelist[i], ext);
	        var croppixel = croppixelarr[i];
		if (!window.cropW) {
	            var cropvftext = 'setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,crop=in_w:in_h-' + croppixel + ':0:' + croppixel;
	        } else {
	            var cropWidth = Math.round(widtharr[i] * window.cropW);
	            var cropHeight = Math.round(heightarr[i] * window.cropH);
	            var cropXstart = Math.round(widtharr[i] * window.cropX);
	            var cropYstart = Math.round(heightarr[i] * window.cropY);
	            var cropvftext = 'setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,crop=' + cropWidth + ':' + cropHeight + ':' + cropXstart + ':' + cropYstart;
	        }
	        if (isclip(filelist[i])) {
	            var outfile = path.join(workdir, nexti + '.mp4');
	            myqueue.push(customSpawn(ffmpegpath, ['-i', filelist[i], '-an', '-map_metadata', '-1', '-vf', cropvftext, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-y', '-pix_fmt', 'yuv420p', outfile]));
	        } else {
	            var outfile = path.join(workdir, nexti + '.png');
	            myqueue.push(customSpawn(ffmpegpath, ['-i', filelist[i], '-map_metadata', '-1', '-vf', cropvftext, '-f', 'image2', '-y', '-pix_fmt', 'rgb24', outfile]));
	        }
	        croppedfilelist.push(outfile);
		myqueue.push(progress(i));
	}
	//myqueue.push(console.log(croppedfilelist));
	myqueue.push(upload(i)); //LAST ITEM IN QUEUE, CALL UPLOAD QUEUE
	//myqueue.push(progressend(i));
	//for (var i = 0; i < myqueue.length; i++) { console.log(myqueue[i]);}
	window.start = performance.now();
	queue(myqueue).then(([cmd, args]) => {
		console.log(cmd + ' finished - all finished');
	}).catch(function(error) {
		// console.error(error.stack);
	}); //.catch(TypeError, function(e) {}).catch(err => console.log(err));
	//DELETE PREVIEWS
	for (var j = 1; j < previewindex + 1; j++) {
		for (var i = 0; i < filelist.length; i++) {
			var nexti = i + 1;
			var delfile = path.join(workdir, nexti + '.' + j + '.png');
			fs.unlink(delfile);
		}
	}
});

var form;

function sendFiles(fileList, url) {
	console.log(fileList, url);
	return () => new Promise((resolve, reject) => {
		form = new FormData();
		for (i = 0; i < fileList.length; i++) {
			var thisfile = fs.readFileSync(fileList[i]);
			// console.log(fileList[i]);
			var nameonly = path.basename(fileList[i]);
			form.append('file[]', thisfile, nameonly);
		}

		let formHeaders = form.getHeaders();
		axios.post(
			url,
			form, {
				adapter: require('axios/lib/adapters/http'),
				headers: {
					...formHeaders,
				},
				maxBodyLength: Infinity,
				maxBodyLength: Infinity

			}
		).then((response) => {
			console.log(response.data); //.data.length);
			resolve(1);
		}).catch(error => {
			console.log(error)
		})
	});
}

function upload() {
	return () => new Promise((resolve, reject) => {
		var myqueue = [];
		finallink = 'https://www.sonoclipshare.com/archive.php?&f=' + folder;
		if (title) { //NEW ARCHIVE URL
			title = encodeURIComponent(title);
			var uploadlink = 'https://www.sonoclipshare.com/uploadapp3.php?&token=' + id_token + '&t=' + title + '&f=' + folder;
		} else { //ADD TO ARCHIVE
			var uploadlink = 'https://www.sonoclipshare.com/uploadapp3.php?&f=' + folder + '&token=' + id_token;
		}
		var localfile = [];
		var cookie = path.join(workdir,'cookie');

		for (var i = 0; i < croppedfilelist.length; i += 3) {
			var last = Math.min(croppedfilelist.length, i + 2);
			console.log('last:' + last,croppedfilelist.length);
			var uploadList = croppedfilelist.slice(i, last);
			myqueue.push(sendFiles(uploadList, uploadlink));
			myqueue.push(progressUL(last));
		}
		myqueue.push(progressend(1));
		queue(myqueue).then(([cmd, args]) => {
			console.log(cmd + ' finished - all finished');
		}).catch(function(error) {
			console.error(error.stack);
		});
		resolve(i);
	});

}

function uploadqueue(i) {
	return () => new Promise((resolve, reject) => {

		/*
                for (var i = 0; i < croppedfilelist.length; i++) {
                        console.log("upload: " + croppedfilelist[i]);
                }
		*/
		resolve(i);
	});
}
var filepaths = [];

function preview() {
	var myqueue = [];
	previewindex = previewindex + 1;
	$('#img-grid').html('');

	widtharr = [];
	heightarr = [];
	croppixelarr = [];
	myqueue = [];
	var skip = 0;
	for (var i = 0; i < filelist.length; i++) {
		var nameonly = filelist[i].split("\\");
		nameonly = nameonly.slice(-1);
		nameonly = nameonly.join();
		var ext = nameonly.split(".").slice(-1);
		var basename = nameonly.split(".");
		basename.pop();
		basename = basename.join(".");
		var folderonly = filelist[i].split("\\");
		folderonly.pop();
		folderonly = folderonly.join("\\");
		filecrop = folderonly + '\\' + basename + '_crop.' + ext;
		filepaths.push(filecrop);

		var nexti = i + 1;
		var ffprobe = spawnsync(ffprobepath, ['-print_format', 'json', '-show_streams', '-select_streams', 'v', '-i', filelist[i]]);
		if (ffprobe.status.toString() == 0) {
			var ffprobeOb = JSON.parse(ffprobe.stdout);
			width = ffprobeOb.streams[0].width;
			height = ffprobeOb.streams[0].height;
			if (isstill(filelist[i])) {
				if (width < 50 || height < 50) {
					var filename = filepaths[i].replace(/^.*[\\\/]/, '');
					$('#croplist').append(originals[i].toString() + ' was removed because it was a tiny image' + '<br>');

					filelist.splice(i, 1);
					filepaths.splice(i, 1);
					originals.splice(i, 1);
					i = i - 1;
					skip = 1;
				}
			}
			var outfile = path.join(workdir, nexti + '.' + previewindex + '.png');
			var croppixel = 2 * Math.round(height * window.croppixelperc / 2);
			widtharr.push(width);
			heightarr.push(height);
			croppixelarr.push(croppixel);
			if (!window.cropW) {
				var cropvftext = 'setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,crop=in_w:in_h-' + croppixel + ':0:' + croppixel + ',scale=650:-1';
			} else {
				var cropWidth = Math.round(widtharr[i] * window.cropW);
				var cropHeight = Math.round(heightarr[i] * window.cropH);
				var cropXstart = Math.round(widtharr[i] * window.cropX);
				var cropYstart = Math.round(heightarr[i] * window.cropY);
				var cropvftext = 'setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,crop=' + cropWidth + ':' + cropHeight + ':' + cropXstart + ':' + cropYstart + ',scale=650:-1';
			}
			myqueue.push(customSpawn(ffmpegpath, ['-i', filelist[i], '-an', '-vf', cropvftext, '-map_metadata', '-1', '-pix_fmt', 'rgb24', '-vframes', '1', '-f', 'image2', '-y', outfile]));
		} else {
			var filename = filepaths[i].replace(/^.*[\\\/]/, '');
			$('#croplist').append(originals[i].toString() + ' was ignored because it was not an image file' + '<br>');
			//console.log(originals[i].toString());
			originals.splice(i, 1);
			filelist.splice(i, 1);
			filepaths.splice(i, 1);
			i = i - 1;
			skip = 1;

		}
		if (skip != 1) {
			myqueue.push(previewdump(nexti));
		} else {
			skip = 0;
		}
	}
	$('#loading-container').hide();
	$('#preview').show();
	$('#previewsize').show();
	$('#previewsizetext').show();
	myqueue.push(showbtns());
	queue(myqueue).then(([cmd, args]) => {
		console.log(cmd + ' finished - all finished');
	}).catch(TypeError, function(e) {}).catch(err => console.log(err));
}

function previewdump(i) {
	return () => new Promise((resolve, reject) => {
		var outfile = path.join(workdir, i + '.' + previewindex + '.png');
		var widthcrop = 300;
		var heightcrop = Math.round((heightarr[i - 1] - croppixelarr[i - 1]) * 300 / widtharr[i - 1]);
		var imagehtml = '<div class="previewimg"><img src="' + outfile + '" width="' + widthcrop + 'px"></img></div>';
		//imagehtml = '<td><img src="' + outfile + '" width="' + widthcrop + 'px" height="' + heightcrop + 'px"></img></td>';
		$('#img-grid').append(imagehtml);
		resolve(i);
	});
}
$('#manualbtn').click(function() {
	window.draw = 1;
	$('#preview').hide();
	dim = canvasbg(filelist);
	width = dim.streams[0].width;
	height = dim.streams[0].height;
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
$('#myCanvas').click(function() {
	//console.log(Math.round(window.cropY / canvasaspect));
});
$('#filelistbtn').click(function() {
	$('#filelistwrap').hide();
	for (var i = 0; i < filelist.length; i++) {
		$('#filelist').append(i + ': ' + filelist[i] + '<br />');
	}
	$('#filelistwrap').show();
	$('body, html').scrollLeft(1000);
	$(this).hide();
	$('#previewbtn').fadeIn();
	$('#addbtn').fadeIn();
});
$('#addbtn').click(function() {
	$('#filelist').html('');
	$('#filelistwrap').hide();
	$('#filelistwrap').show();
	$(this).hide();
	$('#filelistbtn').fadeIn();
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
	console.log('trying to load');
	loadmyarchives();
});

function loadmyarchives() {
	$('#loading-text').hide();
	$('#loading-container').show();
	$('#myarchives').html('<option value="Select">Select</option>');
	var url = "https://www.sonoclipshare.com/myarchivesapp.php?&token=" + id_token;
	$.ajax({
		cache: false,
		url: url,
		data: {},
		dataType: 'json',
		type: 'GET',
		async: true,
		success: function(response) {
			//console.log(response);
			$('#loading-text').show();
			$('#loading-container').hide();
			if (response != null) {
				for (var item in response) {
					if (response.hasOwnProperty(item)) {
						var nextitem = 'archive#' + response[item].archive + ' , ' + response[item].date + ' , ' + response[item].title;
						var folder = response[item].folder;
						$('#myarchives').append('<option value=' + folder + '>' + nextitem + '</option>');
						//$('#addornew').css('display', 'table');
						//$('#home').show();
					}
				}
			} else {
				$('#newtitlemessage').html('Give your first Archive a title');
				console.log("null result");
			}
			//console.log(response);
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
		console.log("OK, will create archive with title/folder: " + title + '/' + folder);
	}
});
$('#okselect').click(function() {
	//console.log($('#myarchives').val());
	folder = $('#myarchives').val();
	if (folder != 'Select') {
		$('#addselect').hide();
		$('#filelistwrap').fadeIn();
	}
});
$('#home').click(function() {
	$('#activefile').hide();
	$('#activefileUL').hide();
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
	$('#myProgress').hide();
	$('#myProgressUL').hide();
	$('#newtitle').hide();
	$('#preview').hide();
	$('#previewbtn').hide();
	$('#progressmsg').hide();
	$('#progressmsgUL').hide();
	filelist = [];
	$('#filelist').html('');
	addfilestatus();
	$('#drag').css('visibility', 'visible');
	$('#manualbtn').hide();
	//$('button').hide();
});

function onbeforeunload(e) {
	console.log('>>>> onbeforeunload called');
	e.returnValue = "false";
};
