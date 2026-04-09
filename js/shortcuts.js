import {gsUtils} from "./helpers/gsUtils.js";

/*global chrome, gsUtils */
(function(global) {
  'use strict';

  const commandDescriptionKeys = {
    '1-suspend-tab':              'ext_cmd_toggle_tab_suspension_description',
    '2-toggle-temp-whitelist-tab':'ext_cmd_toggle_tab_pause_description',
    '2a-suspend-selected-tabs':   'ext_cmd_suspend_selected_tabs_description',
    '2b-unsuspend-selected-tabs': 'ext_cmd_unsuspend_selected_tabs_description',
    '3-suspend-active-window':    'ext_cmd_soft_suspend_active_window_description',
    '3b-force-suspend-active-window': 'ext_cmd_force_suspend_active_window_description',
    '4-unsuspend-active-window':  'ext_cmd_unsuspend_active_window_description',
    '4b-soft-suspend-all-windows':'ext_cmd_soft_suspend_all_windows_description',
    '5-suspend-all-windows':      'ext_cmd_force_suspend_all_windows_description',
    '6-unsuspend-all-windows':    'ext_cmd_unsuspend_all_windows_description',
  };

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var shortcutsEl = document.getElementById('keyboardShortcuts');
    var configureShortcutsEl = document.getElementById('configureShortcuts');

    var notSetMessage = gsUtils.getMessage('js_shortcuts_not_set');
    var groupingKeys = [
      '2-toggle-temp-whitelist-tab',
      '2b-unsuspend-selected-tabs',
      '4-unsuspend-active-window',
    ];

    //populate keyboard shortcuts
    chrome.commands.getAll(commands => {
      commands.forEach(command => {
        if (command.name !== '_execute_browser_action') {
          const shortcut =
            command.shortcut !== ''
              ? gsUtils.formatHotkeyString(command.shortcut)
              : '(' + notSetMessage + ')';
          const msgKey = commandDescriptionKeys[command.name];
          const description = msgKey
            ? (gsUtils.getMessage(msgKey) || command.description)
            : command.description;
          var addMarginBottom = groupingKeys.includes(command.name);
          shortcutsEl.innerHTML += `<div ${
            addMarginBottom ? ' class="bottomMargin"' : ''
          }>${description}</div>
            <div class="${
              command.shortcut ? 'hotkeyCommand' : 'lesserText'
            }">${shortcut}</div>`;
        }
      });
    });

    //listener for configureShortcuts
    configureShortcutsEl.onclick = function(e) {
      chrome.tabs.update({ url: 'chrome://extensions/shortcuts' });
    };
  });

})(this);
