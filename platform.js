// Add this to the top of platform.js after the existing require statements

const { HomebridgePlatform } = require('./base');
const { assert } = require('chai');

const npmPackage = require('./package.json');
const Accessory = require('./accessories');
const checkForUpdates = require('./helpers/checkForUpdates');
const broadlink = require('./helpers/broadlink');
const { discoverDevices } = require('./helpers/getDevice');
const { createAccessory } = require('./helpers/accessoryCreator');

const classTypes = {
  'learn-ir': Accessory.LearnCode,
  'learn-code': Accessory.LearnCode,
  'smart-toilet-seat': Accessory.SmartToiletSeat
}

let homebridgeRef

const BroadlinkRMPlatform = class extends HomebridgePlatform {

  constructor (log, config = {}) {
    super(log, config, homebridgeRef);
    
    // Enhanced logging configuration
    this.setupLogging(log, config);
  }

  setupLogging(log, config) {
    // Store original log function for potential restoration
    this.originalLog = log;
    
    // Create enhanced logging wrapper that integrates with Homebridge Config UI-X
    this.enhancedLog = (message, ...args) => {
      const timestamp = new Date().toLocaleString();
      const formattedMessage = `[${timestamp}] [Smart Toilet Seat] ${message}`;
      
      // Call original log function
      this.originalLog(formattedMessage, ...args);
      
      // Also make available to Config UI-X logs
      if (typeof console !== 'undefined') {
        console.log(formattedMessage, ...args);
      }
    };

    // Create level-specific logging functions
    this.logInfo = (message, ...args) => {
      if (this.logLevel <= 2) {
        this.enhancedLog(`\x1b[35m[INFO]\x1b[0m ${message}`, ...args);
      }
    };

    this.logDebug = (message, ...args) => {
      if (this.logLevel <= 1) {
        this.enhancedLog(`\x1b[33m[DEBUG]\x1b[0m ${message}`, ...args);
      }
    };

    this.logError = (message, ...args) => {
      if (this.logLevel <= 4) {
        this.enhancedLog(`\x1b[31m[ERROR]\x1b[0m ${message}`, ...args);
      }
    };

    this.logWarning = (message, ...args) => {
      if (this.logLevel <= 3) {
        this.enhancedLog(`\x1b[33m[WARNING]\x1b[0m ${message}`, ...args);
      }
    };
  }

  addAccessories (accessories) {
    const { config, log, logLevel } = this;

    this.discoverBroadlinkDevices();
    this.showMessage();
    setTimeout(() => checkForUpdates(log), 1800);

    if (!config.accessories) {config.accessories = []}

    // Add a Learn Code accessory if none exist in the config
    const learnIRAccessories = (config && config.accessories && Array.isArray(config.accessories)) ? config.accessories.filter((accessory) => (accessory.type === 'learn-ir' || accessory.type === 'learn-code')) : [];

    if (learnIRAccessories.length === 0) {
      if (!config.hideLearnButton) {
        const learnCodeAccessory = new Accessory.LearnCode(log, { name: 'Learn', scanFrequency: false });
        accessories.push(learnCodeAccessory);
        this.logInfo('Added Learn Code accessory');
      }

      if (!config.hideScanFrequencyButton) {
        const scanFrequencyAccessory = new Accessory.LearnCode(log, { name: 'Scan Frequency', scanFrequency: true });
        accessories.push(scanFrequencyAccessory);
        this.logInfo('Added Scan Frequency accessory');
      }
    }

    // Iterate through the config accessories
    config.accessories.forEach((accessory, index) => {
      if (!accessory.type) {
        const error = `Accessory ${index + 1}: Each accessory must be configured with a "type". e.g. "smart-toilet-seat"`;
        this.logError(error);
        throw new Error(error);
      }
      
      if (accessory.disabled) {
        this.logInfo(`Skipping disabled accessory: ${accessory.name || `Accessory ${index + 1}`}`);
        return;
      }
      
      if (!classTypes[accessory.type]) {
        const error = `Accessory ${accessory.name || index + 1}: homebridge-smart-toilet-seat doesn't support accessories of type "${accessory.type}".`;
        this.logError(error);
        throw new Error(error);
      }

      try {
        const homeKitAccessory = new classTypes[accessory.type](log, accessory);
        accessories.push(homeKitAccessory);
        
        this.logInfo(`Successfully added ${accessory.type} accessory: ${accessory.name || `Accessory ${index + 1}`}`);
        if (logLevel <= 1) {
          this.logDebug(`Accessory details - Type: ${accessory.type}, Name: ${accessory.name}`);
        }
      } catch (error) {
        this.logError(`Failed to create accessory ${accessory.name || index + 1}: ${error.message}`);
        throw error;
      }
    });

    this.logInfo(`Platform initialization complete. Total accessories: ${accessories.length}`);
  }

  discoverBroadlinkDevices () {
    const { config, log, logLevel } = this;
    const { hosts } = config;

    if (!hosts) {
      this.logInfo('Automatically discovering Broadlink RM devices...');
      discoverDevices(true, log, logLevel, config.deviceDiscoveryTimeout);
      return;
    }

    discoverDevices(false, log, logLevel);
    this.logInfo('Automatic Broadlink RM device discovery has been disabled as the "hosts" option has been set.');

    assert.isArray(hosts, `\x1b[31m[CONFIG ERROR] \x1b[33mhosts\x1b[0m should be an array of objects.`)

    hosts.forEach((host, index) => {
      assert.isObject(host, `\x1b[31m[CONFIG ERROR] \x1b[0m Each item in the \x1b[33mhosts\x1b[0m array should be an object.`)

      const { address, isRFSupported, isRM4, mac } = host;
      assert(address, `\x1b[31m[CONFIG ERROR] \x1b[0m Host ${index + 1}: Each object in the \x1b[33mhosts\x1b[0m option should contain a value for \x1b[33maddress\x1b[0m (e.g. "192.168.1.23").`)
      assert(mac, `\x1b[31m[CONFIG ERROR] \x1b[0m Host ${index + 1}: Each object in the \x1b[33mhosts\x1b[0m option should contain a unique value for \x1b[33mmac\x1b[0m (e.g. "34:ea:34:e7:d7:28").`)

      //Create manual device type
      let deviceType = 0x2221;
      deviceType = isRFSupported ? (deviceType | 0x2) : deviceType;
      deviceType = isRM4 ? (deviceType | 0x4) : deviceType;
      
      broadlink.addDevice({ address, port: 80 }, mac.toLowerCase(), deviceType);
      
      this.logInfo(`Added manual device: ${address} (${mac}) - RM4: ${isRM4}, RF: ${isRFSupported}`);
    })
  }

  showMessage () {
    const { config, log } = this;

    if (config && (config.hideWelcomeMessage || config.isUnitTest || this.logLevel >= 4)) {
      this.logInfo(`Running Smart Toilet Seat Plugin version \x1b[32m${npmPackage.version}\x1b[0m`);
      return
    }

    setTimeout(() => {
      log('')
      log(`**************************************************************************************************************`)
      log(`** Welcome to the \x1b[34mSmart Toilet Seat Plugin\x1b[0m!`)
      log('** ')
      log(`** Control your smart toilet seat with HomeKit using IR commands.`)
      log(`** `)
      log(`** Plugin Version: ${npmPackage.version}`)
      log(`** Log Level: ${config.logLevel || 'info'}`)
      log(`** `)
      log(`** You can disable this message by adding "hideWelcomeMessage": true to the config.`)
      log(`**`)
      log(`**************************************************************************************************************`)
      log('')
    }, 1500)
  }
}

BroadlinkRMPlatform.setHomebridge = (homebridge) => {
  homebridgeRef = homebridge
}

module.exports = BroadlinkRMPlatform