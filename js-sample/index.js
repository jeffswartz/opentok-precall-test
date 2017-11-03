/* global require */

var OTNetworkTest = require('opentok-network-test');
var OTNetworkTestOptions = require('./config.js');
var statusContainerEl = document.getElementById('status_container');

var otNetworkTest = new OTNetworkTest(
  OTNetworkTestOptions.apiKey,
  OTNetworkTestOptions.sessionId,
  OTNetworkTestOptions.token
);

function setStatus(text, icon) {
  var statusMessageEl = statusContainerEl.querySelector('p');

  if (statusMessageEl.textContent) {
    statusMessageEl.textContent = text;
  } else if (statusMessageEl.innerText) {
    statusMessageEl.innerText = text;
  }

  if (icon) {
    statusContainerEl.querySelector('img').src = 'assets/icon_' + icon + '.svg';
  }
}

otNetworkTest.onStatus(function (process, status) {
  setStatus(status);
});

otNetworkTest.testPublishing(function (error, status) {
  if (error) {
    setStatus(error.message, 'error');
    return;
  }
  setStatus(status.text, status.category);
});
