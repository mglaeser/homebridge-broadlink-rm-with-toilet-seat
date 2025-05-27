const ToiletSeatPlatform = require('./platform')

module.exports = (homebridge) => {
  global.Service = homebridge.hap.Service;
  global.Characteristic = homebridge.hap.Characteristic;

  ToiletSeatPlatform.setHomebridge(homebridge);

  homebridge.registerPlatform("homebridge-toilet-seat", "IR-Toilet-Seat", ToiletSeatPlatform);
}
