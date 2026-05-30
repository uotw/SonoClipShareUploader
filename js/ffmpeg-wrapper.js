// ffmpeg-wrapper.js - Cross-platform CPU (libx264) encoder wrapper.
//
// Hardware acceleration was removed deliberately. For this app's workload
// (short 3-10s ultrasound clips de-identified on laptops), libx264 is as fast
// or faster than per-clip GPU session setup, gives equal-or-better quality per
// bit, and is a single code path that behaves identically across all hardware
// (no driver-version landmines, no GPU cold-start, no per-device QA matrix).
// Encoding matches the app's original settings: libx264 -preset medium -crf 14.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

class FFmpegWrapper {
    constructor() {
        this.ffmpegPath = null;
        this.ffprobePath = null;
        this.binariesWarmedUp = false;

        // Only initialize paths in the constructor.
        this.initPromise = this.initializePaths();
    }

    async initializePaths() {
        console.log('Initializing FFmpeg paths for platform:', os.platform(), os.arch());

        this.ffmpegPath = this.getFFmpegPath();
        this.ffprobePath = this.getFFprobePath();

        console.log('FFmpeg path:', this.ffmpegPath);
        console.log('FFprobe path:', this.ffprobePath);

        await this.verifyBinaries();
    }

    getFFmpegPath() {
        const platform = os.platform();

        if (platform === 'win32') {
            // For Windows builds, use manually included binary
            const customPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
            if (fs.existsSync(customPath)) {
                return customPath;
            }

            // Fallback: try to use ffmpeg-static if available
            try {
                const ffmpegStatic = require('ffmpeg-static');
                if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
                    return ffmpegStatic;
                }
            } catch (e) {
                console.warn('ffmpeg-static not available for Windows');
            }

            throw new Error('Windows ffmpeg.exe not found. Please place ffmpeg.exe in the bin/ directory.');

        } else {
            // For Mac/Linux, use ffmpeg-static
            try {
                const ffmpegStatic = require('ffmpeg-static');
                if (!ffmpegStatic || !fs.existsSync(ffmpegStatic)) {
                    throw new Error('ffmpeg-static binary not found');
                }
                return ffmpegStatic;
            } catch (e) {
                throw new Error('ffmpeg-static package not available: ' + e.message);
            }
        }
    }

    getFFprobePath() {
        const platform = os.platform();
        const arch = os.arch();

        try {
            const ffprobeStatic = require('ffprobe-static');

            if (platform === 'win32') {
                const winArch = arch === 'x64' ? 'x64' : 'ia32';
                const probePath = path.join(
                    path.dirname(require.resolve('ffprobe-static/package.json')),
                    'bin', 'win32', winArch, 'ffprobe.exe'
                );

                if (fs.existsSync(probePath)) {
                    return probePath;
                }
            } else if (platform === 'darwin') {
                const macArch = arch === 'arm64' ? 'arm64' : 'x64';
                const probePath = path.join(
                    path.dirname(require.resolve('ffprobe-static/package.json')),
                    'bin', 'darwin', macArch, 'ffprobe'
                );

                if (fs.existsSync(probePath)) {
                    return probePath;
                }
            } else if (platform === 'linux') {
                const linuxArch = arch === 'x64' ? 'x64' : 'ia32';
                const probePath = path.join(
                    path.dirname(require.resolve('ffprobe-static/package.json')),
                    'bin', 'linux', linuxArch, 'ffprobe'
                );

                if (fs.existsSync(probePath)) {
                    return probePath;
                }
            }

            // Fallback to the .path property
            if (ffprobeStatic.path && fs.existsSync(ffprobeStatic.path)) {
                console.warn('Using fallback ffprobe path:', ffprobeStatic.path);
                return ffprobeStatic.path;
            }

        } catch (e) {
            console.error('ffprobe-static package error:', e.message);
        }

        throw new Error(`FFprobe binary not found for ${platform} ${arch}`);
    }

    async verifyBinaries() {
        if (!fs.existsSync(this.ffmpegPath)) {
            throw new Error(`FFmpeg binary not found at: ${this.ffmpegPath}`);
        }

        if (!fs.existsSync(this.ffprobePath)) {
            throw new Error(`FFprobe binary not found at: ${this.ffprobePath}`);
        }

        // Make sure binaries are executable on Unix systems
        if (os.platform() !== 'win32') {
            try {
                fs.chmodSync(this.ffmpegPath, '755');
                fs.chmodSync(this.ffprobePath, '755');
            } catch (e) {
                console.warn('Could not set executable permissions:', e.message);
            }
        }

        console.log('Binary verification complete');
    }

    // Warm up FFprobe and FFmpeg binaries to avoid cold-start delays on the
    // first real operation. Call once at app launch.
    async warmupBinaries() {
        if (this.binariesWarmedUp) {
            return;
        }

        console.log('Warming up FFmpeg binaries...');
        const warmupStart = performance.now();

        try {
            await this.initPromise;
            await this.warmupFFprobe();
            await this.warmupFFmpeg();

            this.binariesWarmedUp = true;
            const warmupEnd = performance.now();
            console.log(`Binary warmup completed in ${(warmupEnd - warmupStart).toFixed(2)}ms`);
        } catch (error) {
            console.warn('Binary warmup failed (non-critical):', error.message);
        }
    }

    async warmupFFprobe() {
        return new Promise((resolve) => {
            const child = spawn(this.ffprobePath, ['-version'], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };

            child.on('close', finish);
            child.on('error', finish);
            setTimeout(() => { if (!done) { child.kill(); finish(); } }, 3000);
        });
    }

    async warmupFFmpeg() {
        return new Promise((resolve) => {
            const child = spawn(this.ffmpegPath, ['-version'], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };

            child.on('close', finish);
            child.on('error', finish);
            setTimeout(() => { if (!done) { child.kill(); finish(); } }, 3000);
        });
    }

    // Execute an FFmpeg command. Resolves with {stdout, stderr} on success.
    exec(args, options = {}) {
        return new Promise((resolve, reject) => {
            console.log('FFmpeg command:', this.ffmpegPath, args.join(' '));

            const child = spawn(this.ffmpegPath, args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();

                // Parse progress from stderr
                if (options.onProgress) {
                    const progressMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
                    if (progressMatch) {
                        const hours = parseInt(progressMatch[1]);
                        const minutes = parseInt(progressMatch[2]);
                        const seconds = parseFloat(progressMatch[3]);
                        const totalSeconds = hours * 3600 + minutes * 60 + seconds;

                        if (options.duration) {
                            const percent = Math.min((totalSeconds / options.duration) * 100, 100);
                            options.onProgress(percent);
                        }
                    }
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });
        });
    }

    // Execute an FFprobe command and return parsed JSON metadata.
    probe(inputPath) {
        return new Promise((resolve, reject) => {
            const args = [
                '-print_format', 'json',
                '-show_streams',
                '-show_format',
                inputPath
            ];

            console.log('FFprobe command:', this.ffprobePath, args.join(' '));

            const child = spawn(this.ffprobePath, args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const metadata = JSON.parse(stdout);
                        resolve(metadata);
                    } catch (err) {
                        reject(new Error(`Failed to parse FFprobe output: ${err.message}`));
                    }
                } else {
                    reject(new Error(`FFprobe failed with code ${code}: ${stderr}`));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });
        });
    }

    // De-identify + transcode a video on the CPU (libx264). Strips audio and all
    // metadata, applies the crop filter (which also scales to 800px wide), and
    // encodes to match the server worker's web-delivery profile: CRF 20 +
    // +faststart so desktop uploads (which bypass the worker) are the same size
    // and stream the same way as worker-processed clips. preset medium (not the
    // worker's 'faster') because the desktop encodes one clip while the user
    // waits, so it can afford better quality-per-bit at the same CRF.
    async processVideo(inputPath, outputPath, cropFilter, options = {}) {
        await this.initPromise;

        const args = ['-i', inputPath, '-an', '-map_metadata', '-1'];
        if (cropFilter) {
            args.push('-vf', cropFilter);
        }
        args.push(
            '-c:v', 'libx264',
            '-preset', options.preset || 'medium',
            '-crf', options.crf || '20',
            '-profile:v', 'high',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-y', outputPath
        );

        return this.exec(args, options);
    }

    // Create thumbnail from video (single frame).
    async createThumbnail(inputPath, outputPath, options = {}) {
        await this.initPromise;

        const args = [
            '-i', inputPath,
            '-map_metadata', '-1',
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            outputPath
        ];

        return this.exec(args, options);
    }

    // Process a standalone image with cropping + metadata removal.
    async processImage(inputPath, outputPath, cropFilter, options = {}) {
        await this.initPromise;

        const args = [
            '-i', inputPath,
            '-map_metadata', '-1',
            '-vf', cropFilter + ',setsar=1',
            '-q:v', '2',            // matches the worker's still-image quality
            '-f', 'image2',
            '-y',
            outputPath
        ];

        return this.exec(args, options);
    }

    // Generate a preview image (cropped single frame).
    async generatePreview(inputPath, outputPath, cropFilter, options = {}) {
        await this.initPromise;

        const args = [
            '-i', inputPath,
            '-an',
            '-vf', cropFilter,
            '-map_metadata', '-1',
            '-pix_fmt', 'rgb24',
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            outputPath
        ];

        return this.exec(args, options);
    }

    // Create the canvas background used by the manual-crop UI.
    async createCanvasBackground(inputPath, outputPath) {
        await this.initPromise;

        const args = [
            '-i', inputPath,
            '-an',
            '-vf', 'scale=500:-1',
            '-pix_fmt', 'rgb24',
            '-vframes', '1',
            '-f', 'image2',
            '-map_metadata', '-1',
            '-y',
            outputPath
        ];

        return this.exec(args);
    }
}

module.exports = FFmpegWrapper;
