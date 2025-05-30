const BroadlinkRMPlatform = require('./platform');
const fakegatoHistory = require('fakegato-history');

module.exports = (homebridge) => {
  HistoryService = fakegatoHistory(homebridge);
  
  global.Service = homebridge.hap.Service;
  global.Characteristic = homebridge.hap.Characteristic;

  BroadlinkRMPlatform.setHomebridge(homebridge);

  // ✅ UNIQUE PLATFORM NAME - No conflict with original BroadlinkRM
  // This creates platform identifier: "SmartToiletSeat" (not "BroadlinkRM")
  homebridge.registerPlatform("SmartToiletSeat", BroadlinkRMPlatform);
};