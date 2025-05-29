const BroadlinkRMPlatform = require('./platform');
const fakegatoHistory = require( 'fakegato-history');

module.exports = (homebridge) => {
  HistoryService = fakegatoHistory( homebridge );
  
  global.Service = homebridge.hap.Service;
  global.Characteristic = homebridge.hap.Characteristic;

  BroadlinkRMPlatform.setHomebridge(homebridge);

  // Register the Smart Toilet Seat platform
  homebridge.registerPlatform("homebridge-smart-toilet-seat", "SmartToiletSeat", BroadlinkRMPlatform);
}