/*global gsUtils, gsIndexedDb */
// eslint-disable-next-line no-unused-vars

import {gsUtils} from "./gsUtils.js"
import {gsIndexedDb} from "./gsIndexedDb.js"

export var gsFavicon = (function () {
  "use strict";

  // const GOOGLE_S2_URL = 'https://www.google.com/s2/favicons?domain_url=';
  const FALLBACK_CHROME_FAVICON_META = {
    favIconUrl: "chrome://favicon/size/16@2x/fallbackChromeFaviconMeta",
    isDark: true,
    normalisedDataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVQ4T2NkoBAwIuuPior6j8O8xmXLljVgk8MwYNmyZdgMfcjAwLAAmyFEGfDv3z9FJiamA9gMIcoAkKsiIiIUsBlClAHofkf2JkED0DWDAnrUgOEfBsRkTpzpgBjN6GoA24V1Efr1zoAAAAAASUVORK5CYII=",
    transparentDataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVQ4T2NkoBAwIuuPioqqx2YeExPTwSVLlhzAJodhwLJlyxrRDWVkZPzIyMh4AZshRBnAxsY28ffv3wnYDCHKAJCrEhISBLAZQpQB6H5H9iZBA9A1gwJ61IDhHwbEZE6c6YAYzehqAAmQeBHM42eMAAAAAElFTkSuQmCC",
  };

  const _defaultFaviconFingerprintById = {};
  let _defaultChromeFaviconMeta;

  async function initAsPromised() {
    await addFaviconDefaults();
    gsUtils.log("gsFavicon", "init successful");
  }

  async function addFaviconDefaults() {
    // Generate a list of potential 'default' favicons so we can avoid caching
    // anything that matches these defaults
    const defaultIconUrls = [
      generateChromeFavIconUrlFromUrl("http://chromeDefaultFavicon"),
      generateChromeFavIconUrlFromUrl("chromeDefaultFavicon"),
      chrome.runtime.getURL("images/icon-16x16.png"),
      chrome.runtime.getURL("images/ch-def-favicon.png"),
      chrome.runtime.getURL("images/ch-def-favicon-sml.png"),
      chrome.runtime.getURL("images/ch-dev-def-favicon.png"),
      chrome.runtime.getURL("images/ch-dev-def-favicon-sml.png"),
    ];

    const faviconPromises = [];
    for (let i = 0; i < defaultIconUrls.length; i += 1) {
      const iconUrl = defaultIconUrls[i];
      faviconPromises.push(
        new Promise(async (resolve) => {
          const faviconMeta = await addDefaultFaviconMeta(iconUrl);
          if (faviconMeta) {
            gsUtils.log(
              "gsFavicon",
              `Successfully built default faviconMeta for url: ${iconUrl}`,
              faviconMeta
            );
          } else {
            gsUtils.warning(
              "gsFavicon",
              `Failed to build faviconMeta for url: ${iconUrl}`
            );
          }
          // Set the first url as the default favicon
          if (i === 0) {
            _defaultChromeFaviconMeta =
              faviconMeta || FALLBACK_CHROME_FAVICON_META;
            gsUtils.log(
              "gsFavicon",
              "Set _defaultChromeFaviconMeta",
              _defaultChromeFaviconMeta
            );
          }
          resolve();
        })
      );
    }
    await Promise.all(faviconPromises);
  }

  async function addDefaultFaviconMeta(url) {
    let faviconMeta;
    try {
      faviconMeta = await gsUtils.executeWithRetries(
        buildFaviconMetaData,
        [url],
        4,
        0
      );
    } catch (e) {
      gsUtils.warning("gsFavicon", e);
    }
    addFaviconMetaToDefaultFingerprints(faviconMeta, url);
    return faviconMeta;
  }

  async function addFaviconMetaToDefaultFingerprints(faviconMeta, id) {
    _defaultFaviconFingerprintById[id] = await createImageFingerprint(
      faviconMeta.normalisedDataUrl
    );
    _defaultFaviconFingerprintById[id + "Transparent"] =
      await createImageFingerprint(faviconMeta.transparentDataUrl);
  }

  function generateChromeFavIconUrlFromUrl(website_url) {
      const url = new URL(chrome.runtime.getURL("/_favicon/"));
      url.searchParams.set("pageUrl", website_url);
      url.searchParams.set("size", "16");
      return url.toString();
  }

  async function getFaviconMetaData(tab) {
    if (gsUtils.isFileTab(tab)) {
      return _defaultChromeFaviconMeta;
    }

    // First try to fetch from cache
    let originalUrl = tab.url;
    if (gsUtils.isSuspendedTab(tab)) {
      originalUrl = gsUtils.getOriginalUrl(tab.url);
    }
    let faviconMeta = await getCachedFaviconMetaData(originalUrl);
    if (faviconMeta) {
      // gsUtils.log(
      //   tab.id,
      //   'Found favicon cache hit for url: ' + originalUrl,
      //   faviconMeta
      // );
      return faviconMeta;
    }

    // Else try to build from chrome's favicon cache
    faviconMeta = await buildFaviconMetaFromChromeFaviconCache(originalUrl);
    if (faviconMeta) {
      gsUtils.log(
        tab.id,
        "Saving faviconMeta from chrome://favicon into cache",
        faviconMeta
      );
      // Save to tgs favicon cache
      await saveFaviconMetaDataToCache(originalUrl, faviconMeta);
      return faviconMeta;
    }

    // Else try to build from tab.favIconUrl
    gsUtils.log(
      tab.id,
      "No entry in chrome favicon cache for url: " + originalUrl
    );
    if (
      tab.favIconUrl &&
      tab.favIconUrl !== chrome.runtime.getURL("images/icon-16x16.png")
    ) {
      faviconMeta = await buildFaviconMetaFromTabFavIconUrl(tab.favIconUrl);
      if (faviconMeta) {
        gsUtils.log(
          tab.id,
          "Built faviconMeta from tab.favIconUrl",
          faviconMeta
        );
        return faviconMeta;
      }
    }

    // Else try to fetch from google
    // if (fallbackToGoogle) {
    //   const rootUrl = encodeURIComponent(gsUtils.getRootUrl(originalUrl));
    //   const tabFavIconUrl = GOOGLE_S2_URL + rootUrl;
    //   //TODO: Handle reject case below
    //   faviconMeta = await buildFaviconMetaData(tabFavIconUrl, 5000);
    //   faviconMetaValid = await isFaviconMetaValid(faviconMeta);
    //   if (faviconMetaValid) {
    //     gsUtils.log(
    //       tab.id,
    //       'Built faviconMeta from google.com/s2 service',
    //       faviconMeta
    //     );
    //     return faviconMeta;
    //   }
    // }

    // Else return the default chrome favicon
    gsUtils.log(tab.id, "Failed to build faviconMeta. Using default icon");
    return _defaultChromeFaviconMeta;
  }

  async function buildFaviconMetaFromChromeFaviconCache(url) {
    const chromeFavIconUrl = generateChromeFavIconUrlFromUrl(url);
    gsUtils.log(
      "gsFavicon",
      `Building faviconMeta from url: ${chromeFavIconUrl}`
    );
    try {
      const faviconMeta = await buildFaviconMetaData(chromeFavIconUrl);
      const faviconMetaValid = await isFaviconMetaValid(faviconMeta);
      if (faviconMetaValid) {
        return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning("gsUtils", e);
    }
    return null;
  }

  async function buildFaviconMetaFromTabFavIconUrl(favIconUrl) {
    try {
      const faviconMeta = await buildFaviconMetaData(favIconUrl);
      const faviconMetaValid = await isFaviconMetaValid(faviconMeta);
      if (faviconMetaValid) {
        return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning("gsUtils", e);
    }
    return null;
  }

  async function getCachedFaviconMetaData(url) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    let faviconMetaData = await gsIndexedDb.fetchFaviconMeta(fullUrl);
    if (!faviconMetaData) {
      const rootUrl = gsUtils.getRootUrl(url, false, false);
      faviconMetaData = await gsIndexedDb.fetchFaviconMeta(rootUrl);
    }
    return faviconMetaData || null;
  }

  async function saveFaviconMetaDataToCache(url, faviconMeta) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    const rootUrl = gsUtils.getRootUrl(url, false, false);
    gsUtils.log(
      "gsFavicon",
      "Saving favicon cache entry for: " + fullUrl,
      faviconMeta
    );
    await gsIndexedDb.addFaviconMeta(fullUrl, Object.assign({}, faviconMeta));
    await gsIndexedDb.addFaviconMeta(rootUrl, Object.assign({}, faviconMeta));
  }

  async function isFaviconMetaValid(faviconMeta) {
    if (
      !faviconMeta ||
      faviconMeta.normalisedDataUrl === "data:," ||
      faviconMeta.transparentDataUrl === "data:,"
    ) {
      return false;
    }
    const normalisedFingerprint = await createImageFingerprint(
      faviconMeta.normalisedDataUrl
    );
    const transparentFingerprint = await createImageFingerprint(
      faviconMeta.transparentDataUrl
    );

    for (let id of Object.keys(_defaultFaviconFingerprintById)) {
      const defaultFaviconFingerprint = _defaultFaviconFingerprintById[id];
      if (
        normalisedFingerprint === defaultFaviconFingerprint ||
        transparentFingerprint === defaultFaviconFingerprint
      ) {
        gsUtils.log(
          "gsFavicon",
          "FaviconMeta not valid as it matches fingerprint of default favicon: " +
            id,
          faviconMeta
        );
        return false;
      }
    }
    return true;
  }

  function dataURItoBlob(dataURI) {
    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
    var byteString = atob(dataURI.split(',')[1]);

    // separate out the mime component
    var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0]

    // write the bytes of the string to an ArrayBuffer
    var ab = new ArrayBuffer(byteString.length);

    // create a view into the buffer
    var ia = new Uint8Array(ab);

    // set the bytes of the buffer to the correct values
    for (var i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    // write the ArrayBuffer to a blob, and you're done
    return new Blob([ab], {type: mimeString});
  }

  // Turns the img into a 16x16 black and white dataUrl
  function createImageFingerprint(dataUrl) {
    return new Promise((resolve) => {
        createImageBitmap(dataURItoBlob(dataUrl)).then(img => {
          const canvas = new OffscreenCanvas(16, 16);
          const context = canvas.getContext("2d");
          const threshold = 80;

          context.drawImage(img, 0, 0, 16, 16);

          const imageData = context.getImageData(0, 0, 16, 16);
          for (var i = 0; i < imageData.data.length; i += 4) {
            var luma = Math.floor(
              imageData.data[i] * 0.3 +
                imageData.data[i + 1] * 0.59 +
                imageData.data[i + 2] * 0.11
            );
            imageData.data[i] =
              imageData.data[i + 1] =
              imageData.data[i + 2] =
                luma > threshold ? 255 : 0;
            imageData.data[i + 3] = 255;
          }
          context.putImageData(imageData, 0, 0);

          const reader = new FileReader();
          reader.addEventListener("load", () => {
            resolve(reader.result);
          });
          canvas.convertToBlob({type: 'image/png'}).then(blob => {
            reader.readAsDataURL(blob);
          });
        });
    });
  }

  function getFavIconDataUrl(canvas, context, imageData, dataArray) {
    return new Promise((resolve) => {
      imageData.data.set(dataArray);
      context.putImageData(imageData, 0, 0);

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        resolve(reader.result);
      });
      canvas.convertToBlob({type: 'image/png'}).then(blob => {
        reader.readAsDataURL(blob);
      });
    });
  }

  function buildFaviconMetaData(url) {
    const timeout = 5 * 1000;
    return new Promise((resolve, reject) => {
      fetch(url)
          .then(response => response.blob())
          .then(blob => {

            let canvas;
            let context;
            canvas = new OffscreenCanvas(16, 16);
            context = canvas.getContext("2d");
            createImageBitmap(blob).then(imageBitmap => {
              context.drawImage(imageBitmap,0,0)
              let imageData;
              try {
                imageData = context.getImageData(0, 0, canvas.width, canvas.height);
              } catch (e) {
                reject(e);
                return;
              }

              const origDataArray = imageData.data;
              const normalisedDataArray = new Uint8ClampedArray(origDataArray);
              const transparentDataArray = new Uint8ClampedArray(origDataArray);

              let r, g, b, a;
              let fuzzy = 0.1;
              let light = 0;
              let dark = 0;
              let maxAlpha = 0;
              let maxRgb = 0;

              for (let x = 0; x < origDataArray.length; x += 4) {
                r = origDataArray[x];
                g = origDataArray[x + 1];
                b = origDataArray[x + 2];
                a = origDataArray[x + 3];

                let localMaxRgb = Math.max(Math.max(r, g), b);
                if (localMaxRgb < 128 || a < 128) dark++;
                else light++;
                maxAlpha = Math.max(a, maxAlpha);
                maxRgb = Math.max(localMaxRgb, maxRgb);
              }

              //saftey check to make sure image is not completely transparent
              if (maxAlpha === 0) {
                reject(
                    "Aborting favicon generation as image is completely transparent. url: " +
                    url
                );
                return;
              }

              const darkLightDiff = (light - dark) / (canvas.width * canvas.height);
              const isDark = darkLightDiff + fuzzy < 0;
              const normaliserMultiple = 1 / (maxAlpha / 255);

              for (let x = 0; x < origDataArray.length; x += 4) {
                a = origDataArray[x + 3];
                normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
              }
              for (let x = 0; x < normalisedDataArray.length; x += 4) {
                a = normalisedDataArray[x + 3];
                transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
              }

              const normalisedDataUrl = getFavIconDataUrl(canvas, context, imageData, normalisedDataArray);
              const transparentDataUrl = getFavIconDataUrl(canvas, context, imageData, transparentDataArray);

              Promise.all([normalisedDataUrl, transparentDataUrl]).then((values) => {
                const normalisedDataUrlResult = values[0];
                const transparentDataUrlResult = values[1];

                const faviconMetaData = {
                  favIconUrl: url,
                  isDark: isDark,
                  normalisedDataUrl: normalisedDataUrlResult,
                  transparentDataUrl: transparentDataUrlResult
                };

                console.log(faviconMetaData);

                resolve(faviconMetaData);
              });
            });
          });
    });
  }



  return {
    initAsPromised,
    getFaviconMetaData,
    generateChromeFavIconUrlFromUrl,
    buildFaviconMetaFromChromeFaviconCache,
    saveFaviconMetaDataToCache,
  };
})();
