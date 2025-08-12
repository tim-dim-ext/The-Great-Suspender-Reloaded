# The Great Suspender Reloaded

<img src="/images/sus-guy.png" width="100px" />

The Great Suspender Reloaded is a secure fork of the classic Google Chrome/Chromium extension that automatically suspends inactive tabs, freeing up memory and CPU resources.

This repository is based on a fork from `https://github.com/greatsuspender/thegreatsuspender`, but has been reworked and renamed to The Great Suspender Reloaded.

### Why Reloaded

- **Secure**: The extension doesn't load external scripts or execute remote code. Everything needed is bundled with this repository.
- **No build process or npm**: To run it, you don't need `npm` commands or additional dependencies. Just download the code and load the folder as an unpacked extension — it's simpler and more reliable.
- **GPL-2.0**: The project is distributed under the GNU GPL v2.0 license, with open code for auditing and modifications.
- **Compatibility**: Works with Google Chrome and compatible Chromium-based browsers.

I created this version primarily for myself, then decided to share it with the community. This is not my main project, so I maintain it on a best-effort basis. If you'd like to contribute — join the development!

### Chrome Web Store

The Great Suspender Reloaded is available in the [Chrome Web Store](https://chromewebstore.google.com/detail/the-great-suspender-reloa/hlofigcdgjlnalbkeeinfcjceabpamci).

The store version may be released less frequently than repository changes.

### Install from source (no build process or npm required)

1. Download the ZIP of this repository or clone it locally.
2. Open `chrome://extensions/` in Chrome and enable "Developer mode".
3. Click "Load unpacked" and select the root project folder (where `manifest.json` is located).
4. After installation, a welcome page will open.

Important: Before removing any other version of the extension, make sure to unsuspend all suspended tabs, otherwise they may be lost forever.


### Contributing and Support

- **PRs and discussions**: Send Pull Requests and open Issues — improvements to stability, security, and UX are especially welcome.
- **Development pace**: The project is maintained on a best-effort basis (this is not my main project).
- **Support the project**: [Patreon](https://patreon.com/The_Great_Suspender_Reloaded).

[![Support on Patreon](images/patron.png)](https://patreon.com/The_Great_Suspender_Reloaded)

### License

This project is distributed under the GNU General Public License v2.0 (GPL-2.0).

### Original Project and Acknowledgments

- Original project: `https://github.com/deanoemcke/thegreatsuspender`.
- This repository is a reworked and secure version (Reloaded). The original project is effectively no longer maintained and was subject to a security incident in the past, which led to its removal from the Chrome Web Store. This is why Reloaded emphasizes transparency and the absence of external scripts.

Acknowledgments:

- [html2canvas](https://github.com/niklasvh/html2canvas) — Niklas von Hertzen.
- [db.js](https://github.com/aaronpowell/db.js) — Aaron Powell.
- Browser testing: [BrowserStack](https://www.browserstack.com).
