# SonoClipShare Uploader
The purpose of SonoClipShare Uploader is to take ultrasound media in a traditional format (mp4, mov, avi, jpg, bmp, png…), remove any Protected Health Information (PHI) locally on your machine, and upload it to an Archive on [SonoClipShare.com](https://www.SonoClipShare.com). The app lets you log in to your personal SonoClipShare account so any uploaded media shows up in your dashboard. SonoClipShare Uploader is built as an [Electron app](https://electronjs.org/) and includes code from [FFmpeg](https://www.ffmpeg.org/).

## Download
**➡️ [Download the latest release](https://github.com/uotw/SonoClipShareUploader/releases/latest)** (always current), or grab a build directly:

These links always point to the most recent release:

| Platform | Download |
| --- | --- |
| **macOS — Apple Silicon** (M1/M2/M3…) | [Download (.dmg)](https://github.com/uotw/SonoClipShareUploader/releases/latest/download/SonoClipShare-Uploader-arm64.dmg) |
| **macOS — Intel** | [Download (.dmg)](https://github.com/uotw/SonoClipShareUploader/releases/latest/download/SonoClipShare-Uploader-x64.dmg) |
| **Windows 64‑bit** | [Download (.exe)](https://github.com/uotw/SonoClipShareUploader/releases/latest/download/SonoClipShare-Uploader-Setup-x64.exe) |

macOS builds are signed with a Developer ID and notarized by Apple; the Windows installer is code‑signed — so neither should trigger a security warning. See [all releases](https://github.com/uotw/SonoClipShareUploader/releases) for previous versions and release notes.

## Support Us
We provide this software free of charge for the ultrasound education community. Please consider supporting us by subscribing to one of [our courses](https://courses.coreultrasound.com/). We have group rates for institutions with more than 10 users.

## Disclaimer
This application provides no guarantee that all Protected Health Information (PHI) has been removed from its resultant images. It is the responsibility of the user to verify that all PHI has been removed from the ultrasound media, including but not limited to 1) hard‑coding of PHI into the images and 2) any PHI that has been placed in the images' metadata.

This software uses code of [FFmpeg](http://ffmpeg.org) licensed under the [LGPLv2.1](http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html); its source can be downloaded from [ffmpeg.org/download](https://www.ffmpeg.org/download.html).

## Development
- Install [Node.js](https://nodejs.org/en/download/) (Node 20+).
- Clone and run:
  ```bash
  git clone https://github.com/uotw/SonoClipShareUploader.git
  cd SonoClipShareUploader
  npm install
  npm start
  ```

### Building locally
```bash
npm run dist-macarm   # macOS Apple Silicon (.dmg)
npm run dist-mac64    # macOS Intel (.dmg)
npm run dist-win64    # Windows x64 (.exe)
```

### Releasing
Signed + notarized macOS DMGs and a signed Windows installer are built automatically by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) when a `v*` tag is pushed:
```bash
npm version patch --no-git-tag-version   # bump version (or minor/major)
git commit -am "Release vX.Y.Z" && git push
git tag vX.Y.Z && git push origin vX.Y.Z
```
The workflow signs, notarizes, publishes a GitHub Release, and notifies the in‑app "update available" banner. Code‑signing credentials are stored as repository secrets — see the workflow for the required names.
