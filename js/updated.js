/*global chrome, gsSession, gsUtils */

import {gsUtils} from "./helpers/gsUtils.js";

function toggleUpdated() {
  document.getElementById("updating").style.display = "none";
  document.getElementById("updated").style.display = "block";
}

chrome.runtime.onMessage.addListener(function(
  request,
  sender,
  sendResponse
) {
  var senderTab = sender.tab;
  if (senderTab !== undefined) {
    senderTab = senderTab.id;
  } else {
    senderTab = -1;
  }
  gsUtils.log(
    senderTab,
    "updated message listener",
    request.action
  );

  if (request.hasOwnProperty('action')) {
    if (request.action === 'toggleUpdated') {
      toggleUpdated();
      sendResponse();
      return false;
    }
  }
  // No async work pending; indicate synchronous handling complete
  return false;
});

gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {
  var versionEl = document.getElementById("updatedVersion");
  versionEl.innerHTML = "v" + chrome.runtime.getManifest().version;

  document.getElementById("sessionManagerLink").onclick = function (e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("html/history.html") });
  };

  chrome.runtime.sendMessage({function: 'updateData'}, function (data) {
    if (chrome.runtime.lastError) {
      gsUtils.error("Error while trying to get update data", chrome.runtime.lastError);
    }

    var updateType = data.getUpdateType;
    if (updateType === "major") {
      document.getElementById("patchMessage").style.display = "none";
      document.getElementById("minorUpdateDetail").style.display = "none";
    } else if (updateType === "minor") {
      document.getElementById("patchMessage").style.display = "none";
      document.getElementById("majorUpdateDetail").style.display = "none";
    } else {
      document.getElementById("updateDetail").style.display = "none";
    }

    if (data.isUpdated) {
      toggleUpdated();
    }
  });
});
