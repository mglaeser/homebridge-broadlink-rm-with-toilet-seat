// smartToiletSeat.js
const BroadlinkRMAccessory = require('./accessory');  // Base class from Broadlink plugin
const { ServiceManagerTypes } = require('../helpers/serviceManagerTypes');  // Broadlink service manager factory
const { Service, Characteristic } = require('hap-nodejs');  // Homebridge HAP classes (if needed for constants)

class SmartToiletSeat extends BroadlinkRMAccessory {
  constructor(log, config = {}, serviceManagerType) {
    super(log, config, serviceManagerType); 
    // You may set default config values here if needed
  }

  // Override the base method to set up multiple services
  setupServiceManager() {
    const { name, log, data, serviceManagerType } = this;
    // Service 1: Switch for main power
    this.serviceManagerPrimary = new ServiceManagerTypes[serviceManagerType](name, Service.Switch, log);
    this.serviceManagerPrimary.addToggleCharacteristic({
      name: 'powerState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.powerOn,   // IR code for power ON
        offData: data.powerOff  // IR code for power OFF
      }
    });

    // Service 2: Outlet for energy saving mode
    this.serviceManagerEnergy = new ServiceManagerTypes[serviceManagerType](`${name} Energy`, Service.Outlet, log);
    this.serviceManagerEnergy.addToggleCharacteristic({
      name: 'energySavingState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.energyOn,
        offData: data.energyOff
      }
    });

    // Service 3: Valve for bidet/shower function 
    this.serviceManagerBidet = new ServiceManagerTypes[serviceManagerType](`${name} Bidet`, Service.Valve, log);
    this.serviceManagerBidet.addToggleCharacteristic({
      name: 'bidetState',
      type: Characteristic.Active,  // Valve uses Active characteristic for On/Off
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.bidetOn,
        offData: data.bidetOff
      }
    });
    // Optionally, you might set Valve Type characteristic if desired (e.g., bidet vs. shower)

    // Service 4: Fan for dryer
    this.serviceManagerFan = new ServiceManagerTypes[serviceManagerType](`${name} Dry Fan`, Service.Fan, log);
    this.serviceManagerFan.addToggleCharacteristic({
      name: 'fanState',
      type: Characteristic.On,  // Fan service uses On for power
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.fanOn,
        offData: data.fanOff
      }
    });

    // Designate one of these as the primary service for the accessory (the first service is typically primary).
    // We will treat the main power Switch as primary:
    this.serviceManager = this.serviceManagerPrimary;
  }

  // Override getServices to include all our services
  getServices() {
    // Start with the standard Accessory Information service:
    const services = this.getInformationServices();
    // Add primary service (already set as this.serviceManager in setup)
    services.push(this.serviceManager.service);
    // Add additional services:
    services.push(this.serviceManagerEnergy.service);
    services.push(this.serviceManagerBidet.service);
    services.push(this.serviceManagerFan.service);
    return services;
  }
}

module.exports = SmartToiletSeat;