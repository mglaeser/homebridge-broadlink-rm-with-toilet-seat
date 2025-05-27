const { HomebridgePlatform } = require('homebridge-platform-helper');

const npmPackage = require('./package.json');
const Accessory = require('./accessories');
const broadlink = require('./helpers/broadlink');
const { assert } = require('chai');  // <-- ADD THIS LINE
const { discoverDevices } = require('./helpers/getDevice');

const classTypes = {
  'smart-toilet-seat': Accessory.SmartToiletSeat
}

let homebridgeRef

const ToiletSeatPlatform = class extends HomebridgePlatform {

  constructor (log, config = {}) {
    super(log, config, homebridgeRef);
  }

  addAccessories (accessories) {
    const { config, log } = this;

    this.discoverToiletDevices();

    if (!config.accessories) config.accessories = []

    // Iterate through the config accessories
    config.accessories.forEach((accessory) => {
      // Optionally hide the accessory from HomeKit
      if (accessory.ignore === true) return

      if (!accessory.type) throw new Error(`Each accessory must be configured with a "type". Currently only "smart-toilet-seat" is supported.`);

      if (!classTypes[accessory.type]) throw new Error(`homebridge-toilet-seat only supports accessories of type "smart-toilet-seat".`);

      const homeKitAccessory = new classTypes[accessory.type](log, accessory);

      accessories.push(homeKitAccessory);
    })
  }

  discoverToiletDevices () {
    const { config, log } = this;
    const { debug, hosts } = config;

    if (!hosts) {
      log(`\x1b[35m[INFO]\x1b[0m Automatically discovering IR devices for toilet seat.`)
      discoverDevices(true, log, debug, config.deviceDiscoveryTimeout);

      return;
    }
    
    discoverDevices(false, log, debug);

    log(`\x1b[35m[INFO]\x1b[0m Automatic IR device discovery has been disabled as the "hosts" option has been set.`)

    if (!Array.isArray(hosts)) {
      throw new Error(`hosts should be an array of objects.`);
    }
      
    hosts.forEach((host) => {
      if (typeof host !== 'object') {
        throw new Error(`Each item in the hosts array should be an object.`);
      }
      
      const { address, isRFSupported, mac } = host;
      if (!address) {
        throw new Error(`Each object in the hosts option should contain a value for address (e.g. "192.168.1.23").`);
      }
      if (!mac) {
        throw new Error(`Each object in the hosts option should contain a unique value for mac (e.g. "34:ea:34:e7:d7:28").`);
      }

      const deviceType = isRFSupported ? 0x279d : 0x2712;

      broadlink.addDevice({ address, port: 80 }, mac, deviceType);
    })
  }
}

ToiletSeatPlatform.setHomebridge = (homebridge) => {
  homebridgeRef = homebridge
}

module.exports = ToiletSeatPlatform
