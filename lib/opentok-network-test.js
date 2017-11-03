/* global document, window, module */

var OT = require('@opentok/client');

var TEST_TIMEOUT_MS = 5000; // 15 seconds

var container = document.createElement('div');
var publisherEl = document.createElement('div');
var subscriberEl = document.createElement('div');

var apiKey;
var sessionId;
var token;
var testCallback;
var statusCallback;
var session;
var publisher;
var subscriber;

var testStreamingCapability = function testStreamingCapability(sub) {
  var audioSupported;
  var audioVideoSupported;
  performQualityTest({ subscriber: sub, timeout: TEST_TIMEOUT_MS }, function (error, results) {
    // If we tried to set video constraints, but no video data was found
    if (!results.video) {
      audioSupported = results.audio.bitsPerSecond > 25000 &&
          results.audio.packetLossRatioPerSecond < 0.05;

      if (audioSupported) {
        testCallback(false, {
          text: 'You can\'t do video because no camera was found, ' +
            'but your bandwidth can support an audio-only stream',
          category: 'warning'
        });
      }

      testCallback(false, {
        text: 'You can\'t do video because no camera was found, ' +
            'and your bandwidth is too low for an audio-only stream',
        category: 'warning'
      });
    }

    audioVideoSupported = results.video.bitsPerSecond > 250000 &&
      results.video.packetLossRatioPerSecond < 0.03 &&
      results.audio.bitsPerSecond > 25000 &&
      results.audio.packetLossRatioPerSecond < 0.05;

    if (audioVideoSupported) {
      testCallback(false, {
        text: 'You\'re all set!',
        category: 'pass'
      });
    }

    if (results.audio.packetLossRatioPerSecond < 0.05) {
      testCallback(false, {
        text: 'Your bandwidth can support audio only',
        category: 'warning'
      });
    }

    // try audio only to see if it reduces the packet loss
    sendStatus('Trying audio only');

    publisher.publishVideo(false);

    performQualityTest({ subscriber: sub, timeout: 5000 }, function (error, results) {
      var audioSupported = results.audio.bitsPerSecond > 25000 &&
          results.audio.packetLossRatioPerSecond < 0.05;

      if (audioSupported) {
        testCallback(false, {
          text: 'Your bandwidth can support audio only',
          category: 'warning'
        });
      }

      testCallback(false, {
        text: 'Your bandwidth is too low for audio',
        category: 'error'
      });
    });
  });
};

var callbacks = {
  onInitPublisher: function onInitPublisher(error) {
    var callbackError;
    if (error) {
      callbackError = new Error('Could not acquire your camera.');
      callbackError.name = 'TestPublishingError';
      testCallback(callbackError);
    }
  },

  onPublish: function onPublish(error) {
    var callbackError;
    if (error) {
      callbackError = new Error('Could not publish video.');
      callbackError.name = 'TestPublishingError';
      testCallback(callbackError);
      return;
    }

    sendStatus('Subscribing to video');

    subscriber = session.subscribe(
      publisher.stream,
      subscriberEl,
      {
        audioVolume: 0,
        testNetwork: true
      },
      callbacks.onSubscribe
    );
  },

  cleanup: function () {
    session.unsubscribe(subscriber);
    session.unpublish(publisher);
  },

  onSubscribe: function onSubscribe(error, subscriber) {
    if (error) {
      sendStatus('Could not subscribe to video');
      return;
    }

    sendStatus('Checking your available bandwidth');

    testStreamingCapability(subscriber, function (error, message) {
      sendStatus(message.text, message.icon);
      callbacks.cleanup();
    });
  },

  onConnect: function onConnect(error) {
    var callbackError;
    if (error) {
      callbackError = new Error('Could not connect to OpenTok.');
      callbackError.name = 'TestPublishingError';
      testCallback(callbackError);
    }
  }
};

compositeOfCallbacks(
  callbacks,
  ['onInitPublisher', 'onConnect'],
  function (error) {
    if (error) {
      return;
    }

    sendStatus('Publishing video');
    session.publish(publisher, callbacks.onPublish);
  }
);

function OTNetworkTest(akey, sid, tok) {
  apiKey = akey;
  sessionId = sid;
  token = tok;
}

OTNetworkTest.prototype.testPublishing = function testPublishing(callback) {
  testCallback = callback;
  container.appendChild(publisherEl);
  container.appendChild(subscriberEl);

  // This publisher uses the default resolution (640x480 pixels) and frame rate (30fps).
  // For other resoultions you may need to adjust the bandwidth conditions in
  // testStreamingCapability().
  publisher = OT.initPublisher(publisherEl, {}, callbacks.onInitPublisher);

  session = OT.initSession(apiKey, sessionId);
  sendStatus('Connecting to session');
  session.connect(token, callbacks.onConnect);
};

OTNetworkTest.prototype.onStatus = function onStatus(callback) {
  statusCallback = callback;
};

// Helpers
function sendStatus(text, icon) {
  if (statusCallback) {
    statusCallback('testNetwork', text, icon);
  }
}

function pluck(arr, propertName) {
  return arr.map(function (value) {
    return value[propertName];
  });
}

function sum(arr, propertyName) {
  if (typeof propertyName !== 'undefined') {
    arr = pluck(arr, propertyName);
  }

  return arr.reduce(function (previous, current) {
    return previous + current;
  }, 0);
}

function max(arr) {
  return Math.max.apply(undefined, arr);
}

function min(arr) {
  return Math.min.apply(undefined, arr);
}

function calculatePerSecondStats(statsBuffer, seconds) {
  var stats = {};
  var activeMediaTypes = Object.keys(statsBuffer[0] || {})
    .filter(function (key) {
      return key !== 'timestamp';
    });

  activeMediaTypes.forEach(function (type) {
    stats[type] = {
      packetsPerSecond: sum(pluck(statsBuffer, type), 'packetsReceived') / seconds,
      bitsPerSecond: (sum(pluck(statsBuffer, type), 'bytesReceived') * 8) / seconds,
      packetsLostPerSecond: sum(pluck(statsBuffer, type), 'packetsLost') / seconds
    };
    stats[type].packetLossRatioPerSecond = (
      stats[type].packetsLostPerSecond / stats[type].packetsPerSecond
    );
  });

  stats.windowSize = seconds;
  return stats;
}

function getSampleWindowSize(samples) {
  var times = pluck(samples, 'timestamp');
  return (max(times) - min(times)) / 1000;
}

function compositeOfCallbacks(obj, fns, callback) {
  var results = {};
  var hasError = false;

  var checkDone = function checkDone() {
    if (Object.keys(results).length === fns.length) {
      callback(hasError, results);
      callback = function () {};
    }
  };

  fns.forEach(function (key) {
    var originalCallback = obj[key];

    obj[key] = function (error) {
      results[key] = {
        error: error,
        args: Array.prototype.slice.call(arguments, 1)
      };

      if (error) {
        hasError = true;
      }

      originalCallback.apply(obj, arguments);
      checkDone();
    };
  });
}

function bandwidthCalculatorObj(config) {
  var intervalId;

  config.pollingInterval = config.pollingInterval || 500;
  config.windowSize = config.windowSize || 2000;
  config.subscriber = config.subscriber || undefined;

  return {
    start: function (reportFunction) {
      var statsBuffer = [];
      var last = {
        audio: {},
        video: {}
      };

      intervalId = window.setInterval(function () {
        config.subscriber.getStats(function (error, stats) {
          var activeMediaTypes = Object.keys(stats).filter(function (key) {
            return key !== 'timestamp';
          });
          var snapshot = {};
          var nowMs = new Date().getTime();
          var sampleWindowSize;

          activeMediaTypes.forEach(function (type) {
            snapshot[type] = Object.keys(stats[type]).reduce(function (result, key) {
              result[key] = stats[type][key] - (last[type][key] || 0);
              last[type][key] = stats[type][key];
              return result;
            }, {});
          });

          // get a snapshot of now, and keep the last values for next round
          snapshot.timestamp = stats.timestamp;

          statsBuffer.push(snapshot);
          statsBuffer = statsBuffer.filter(function (value) {
            return nowMs - value.timestamp < config.windowSize;
          });

          sampleWindowSize = getSampleWindowSize(statsBuffer);

          if (sampleWindowSize !== 0) {
            reportFunction(calculatePerSecondStats(
              statsBuffer,
              sampleWindowSize + (config.pollingInterval / 1000)
            ));
          }
        });
      }, config.pollingInterval);
    },

    stop: function () {
      window.clearInterval(intervalId);
    }
  };
}

function performQualityTest(config, callback) {
  var startMs = new Date().getTime();
  var testTimeout;
  var currentStats;

  var bandwidthCalculator = bandwidthCalculatorObj({
    subscriber: config.subscriber
  });

  var cleanupAndReport = function () {
    currentStats.elapsedTimeMs = new Date().getTime() - startMs;
    callback(undefined, currentStats);

    window.clearTimeout(testTimeout);
    bandwidthCalculator.stop();

    callback = function () {};
  };

  // bail out of the test after 30 seconds
  window.setTimeout(cleanupAndReport, config.timeout);

  bandwidthCalculator.start(function (stats) {
    // you could do something smart here like determine if the bandwidth is
    // stable or acceptable and exit early
    currentStats = stats;
  });
}

module.exports = OTNetworkTest;
