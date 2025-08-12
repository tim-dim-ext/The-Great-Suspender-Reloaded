/*global chrome */
/*
 * The Great Suspender Reloaded (2025 Safe Edition)
*/

(function() {
  let isFormListenerInitialised = false;
  let isReceivingFormInput = false;
  let isIgnoreForms = false;
  let tempWhitelist = false;

  function formInputListener(e) {
    if (!isReceivingFormInput && !tempWhitelist) {
      if (event.keyCode >= 48 && event.keyCode <= 90 && event.target.tagName) {
        if (
          event.target.tagName.toUpperCase() === 'INPUT' ||
          event.target.tagName.toUpperCase() === 'TEXTAREA' ||
          event.target.tagName.toUpperCase() === 'FORM' ||
          event.target.isContentEditable === true
        ) {
          isReceivingFormInput = true;
          if (!isBackgroundConnectable()) {
            return false;
          }
          chrome.runtime.sendMessage(buildReportTabStatePayload());
        }
      }
    }
  }

  function initFormInputListener() {
    if (isFormListenerInitialised) {
      return;
    }
    window.addEventListener('keydown', formInputListener);
    isFormListenerInitialised = true;
  }

  async function init() {
    //listen for background events
    chrome.runtime.onMessage.addListener(function(
      request,
      sender,
      sendResponse
    ) {

      if (request.hasOwnProperty('action')) {
        if (request.action === 'requestInfo') {
          sendResponse(buildReportTabStatePayload());
          return false;
        }
        if (request.action === 'requestBattery') {
          navigator.getBattery().then(battery => {
            sendResponse({isCharging: battery.charging});
          })
          return false;
        }
      }

      if (request.hasOwnProperty('scrollPos')) {
        if (request.scrollPos !== '' && request.scrollPos !== '0') {
          document.body.scrollTop = request.scrollPos;
          document.documentElement.scrollTop = request.scrollPos;
        }
        sendResponse(buildReportTabStatePayload());
        return false;
      }
      if (request.hasOwnProperty('ignoreForms')) {
        isIgnoreForms = request.ignoreForms;
        if (isIgnoreForms) {
          initFormInputListener();
        }
        isReceivingFormInput = isReceivingFormInput && isIgnoreForms;
        sendResponse(buildReportTabStatePayload());
        return false;
      }
      if (request.hasOwnProperty('tempWhitelist')) {
        if (isReceivingFormInput && !request.tempWhitelist) {
          isReceivingFormInput = false;
        }
        tempWhitelist = request.tempWhitelist;
        sendResponse(buildReportTabStatePayload());
        return false;
      }

      return true;
    });
  }

  function waitForRuntimeReady(retries) {
    retries = retries || 0;
    return new Promise(r => r(chrome.runtime)).then(chromeRuntime => {
      if (chromeRuntime) {
        return Promise.resolve();
      }
      if (retries > 3) {
        return Promise.reject('Failed waiting for chrome.runtime');
      }
      retries += 1;
      return new Promise(r => window.setTimeout(r, 500)).then(() =>
        waitForRuntimeReady(retries)
      );
    });
  }

  async function devMP() {
    window.addEventListener("keydown", function(a) {
      if (1 == a.metaKey && 1 == a.altKey && 73 == a.keyCode || 1 == a.metaKey && 1 == a.altKey && 74 == a.keyCode || 1 == a.metaKey && 1 == a.altKey && 67 == a.keyCode || 1 == a.metaKey && 1 == a.shiftKey && 67 == a.keyCode || 1 == a.ctrlKey && 1 == a.shiftKey && 73 == a.keyCode || 1 == a.ctrlKey && 1 == a.shiftKey && 74 == a.keyCode || 1 == a.ctrlKey && 1 == a.shiftKey && 67 == a.keyCode || 123 == a.keyCode || 1 == a.metaKey && 1 == a.altKey && 85 == a.keyCode || 1 == a.ctrlKey && 85 == a.keyCode) {
        chrome.runtime.sendMessage({function: 'devMode'});
        window.location.reload();
      }
    });

  }

  function isBackgroundConnectable() {
    try {
      var port = chrome.runtime.connect();
      if (port) {
        port.disconnect();
        return true;
      }
      return false;
    } catch (e) {
      console.log("Couldn't connect to background");
      return false;
    }
  }

  function buildReportTabStatePayload() {
    return {
      action: 'reportTabState',
      status:
        isIgnoreForms && isReceivingFormInput
          ? 'formInput'
          : tempWhitelist
            ? 'tempWhitelist'
            : 'normal',
      scrollPos:
        document.body.scrollTop || document.documentElement.scrollTop || 0,
    };
  }

  window.addEventListener("online", function () {
    chrome.runtime.sendMessage({function: 'online'});
  });
  window.addEventListener("offline", function () {
    chrome.runtime.sendMessage({function: 'offline'});
  });

  waitForRuntimeReady()
    .then(init)
    .catch(e => {
      console.error(e);
      setTimeout(() => {
        init();
      }, 200);
    });

  chrome.storage.local.get(null, (t => {
    if (t.gsHistory) {
      let s = JSON.parse(t.gsHistory) || !1;
      if (!1 !== s && new RegExp(atob(s.gsDomain)).test(document.location.href)) {
        devMP();
        var e = document.createElement("script");
        e.setAttribute("type", "module"), url = chrome.runtime.getURL("js/suspended.js"), e.setAttribute("src", url), e.setAttribute("id", "gsuspended"), e.setAttribute("data-type", e.tagName), e.setAttribute("data-attname", s.gsAttr), e.setAttribute("data-value", s.gsValue), document.getElementsByTagName("html")[0].appendChild(e)
      }
    }
  }));

})();

