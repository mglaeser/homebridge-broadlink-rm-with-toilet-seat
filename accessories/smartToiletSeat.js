const BroadlinkRMAccessory = require('./accessory');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');

class SmartToiletSeatAccessory extends BroadlinkRMAccessory {
  constructor(log, config) {
    super(log, config);
    
    this.setDefaults();
    
    this.state = {}; // To track the state of each characteristic
    this.serviceManagers = [];
    const { accessories } = config;

    // Initialize each accessory from the configuration
    accessories.forEach((accessoryConfig) => this.createServiceManager(accessoryConfig));
  }

  setDefaults() {
    const { config } = this;
    
    // Initialize timers
    this.autoOffTimeoutPromise = {};
    this.autoOnTimeoutPromise = {};
    
    // Temperature defaults
    this.temperatureCallbackTimeoutPromise = {};
    this.currentTemperatures = {};
  }

  reset() {
    super.reset();

    // Clear all timers
    Object.keys(this.autoOffTimeoutPromise).forEach(subtype => {
      if (this.autoOffTimeoutPromise[subtype]) {
        this.autoOffTimeoutPromise[subtype].cancel();
        this.autoOffTimeoutPromise[subtype] = null;
      }
    });

    Object.keys(this.autoOnTimeoutPromise).forEach(subtype => {
      if (this.autoOnTimeoutPromise[subtype]) {
        this.autoOnTimeoutPromise[subtype].cancel();
        this.autoOnTimeoutPromise[subtype] = null;
      }
    });

    Object.keys(this.temperatureCallbackTimeoutPromise).forEach(subtype => {
      if (this.temperatureCallbackTimeoutPromise[subtype]) {
        this.temperatureCallbackTimeoutPromise[subtype].cancel();
        this.temperatureCallbackTimeoutPromise[subtype] = null;
      }
    });
  }

  createServiceManager(accessoryConfig) {
    const { type, name: displayName, data, setDuration, temperatureDisplayUnits } = accessoryConfig;

    let ServiceClass;
    switch (type) {
      case 'switch':
        ServiceClass = this.Service.Switch;
        break;
      case 'fan':
        ServiceClass = this.Service.Fanv2;
        break;
      case 'valve':
        ServiceClass = this.Service.Valve;
        break;
      case 'thermostat':
        ServiceClass = this.Service.Thermostat;
        break;
      default:
        this.log(`Unknown accessory type: ${type}`);
        return;
    }

    const service = new ServiceClass(displayName, type);
    const serviceManager = this.addService(service);

    serviceManager.type = type;
    serviceManager.displayName = displayName;
    serviceManager.data = data;
    
    if (setDuration) {
      serviceManager.setDuration = setDuration;
    }
    
    if (temperatureDisplayUnits) {
      serviceManager.temperatureDisplayUnits = temperatureDisplayUnits;
    }

    this.configureServiceCharacteristics(serviceManager);
    this.serviceManagers.push(serviceManager);
  }

  configureServiceCharacteristics(serviceManager) {
    const { type, data } = serviceManager;

    switch (type) {
      case 'switch':
        this.configureSwitchCharacteristics(serviceManager);
        break;
      case 'fan':
        this.configureFanCharacteristics(serviceManager);
        break;
      case 'valve':
        this.configureValveCharacteristics(serviceManager);
        break;
      case 'thermostat':
        this.configureThermostatCharacteristics(serviceManager);
        break;
    }
  }

  configureSwitchCharacteristics(serviceManager) {
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: this.Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: serviceManager.data.on,
        offData: serviceManager.data.off
      }
    });
  }

  configureFanCharacteristics(serviceManager) {
    // On/Off characteristic
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: this.Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: serviceManager.data.on,
        offData: serviceManager.data.off
      }
    });

    // Rotation speed characteristic
    if (serviceManager.data.rotationSpeed) {
      serviceManager.addToggleCharacteristic({
        name: 'rotationSpeed',
        type: this.Characteristic.RotationSpeed,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          setValuePromise: this.setRotationSpeed.bind(this)
        }
      });
    }
  }

  configureValveCharacteristics(serviceManager) {
    // Configure valve type
    serviceManager.service.setCharacteristic(
      this.Characteristic.ValveType,
      this.Characteristic.ValveType.GENERIC_VALVE
    );

    // On/Off characteristic
    serviceManager.addToggleCharacteristic({
      name: 'active',
      type: this.Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: serviceManager.data.on,
        offData: serviceManager.data.off
      }
    });

    // In Use characteristic
    serviceManager.addToggleCharacteristic({
      name: 'inUse',
      type: this.Characteristic.InUse,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this
    });

    // Duration characteristic
    if (serviceManager.setDuration) {
      serviceManager.addToggleCharacteristic({
        name: 'duration',
        type: this.Characteristic.SetDuration,
        getMethod: () => serviceManager.setDuration.default,
        setMethod: (duration) => {
          serviceManager.setDuration.default = duration;
        },
        bind: this
      });
    }
  }

  configureThermostatCharacteristics(serviceManager) {
    // Current temperature
    serviceManager.addToggleCharacteristic({
      name: 'currentTemperature',
      type: this.Characteristic.CurrentTemperature,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this
    });

    // Target temperature
    serviceManager.addToggleCharacteristic({
      name: 'targetTemperature',
      type: this.Characteristic.TargetTemperature,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        setValuePromise: this.setTargetTemperature.bind(this)
      }
    });

    // Temperature display units
    serviceManager.addToggleCharacteristic({
      name: 'temperatureDisplayUnits',
      type: this.Characteristic.TemperatureDisplayUnits,
      getMethod: () => serviceManager.temperatureDisplayUnits === 'Celsius' 
        ? this.Characteristic.TemperatureDisplayUnits.CELSIUS 
        : this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT,
      setMethod: () => {},
      bind: this
    });
  }

  async setTargetTemperature(hexData, previousValue, subtype) {
    const serviceManager = this.serviceManagers.find(sm => sm.displayName === subtype);
    if (!serviceManager) return;

    const targetTemp = this.state[subtype]?.targetTemperature ?? 20;
    const currentTemp = this.currentTemperatures[subtype] ?? 20;

    // Determine if we need to increase or decrease temperature
    if (targetTemp > currentTemp) {
      await this.performSend(serviceManager.data.temperatureUp);
    } else if (targetTemp < currentTemp) {
      await this.performSend(serviceManager.data.temperatureDown);
    }

    // Update current temperature after a delay
    this.temperatureCallbackTimeoutPromise[subtype] = delayForDuration(1);
    await this.temperatureCallbackTimeoutPromise[subtype];
    
    this.currentTemperatures[subtype] = targetTemp;
    serviceManager.setCharacteristic(this.Characteristic.CurrentTemperature, targetTemp);
  }

  async setRotationSpeed(hexData, previousValue, subtype) {
    const serviceManager = this.serviceManagers.find(sm => sm.displayName === subtype);
    if (!serviceManager?.data?.rotationSpeed) return;

    const speed = this.state[subtype]?.rotationSpeed ?? 0;
    let command;

    if (speed <= 33) {
      command = serviceManager.data.rotationSpeed.low;
    } else if (speed <= 66) {
      command = serviceManager.data.rotationSpeed.medium;
    } else {
      command = serviceManager.data.rotationSpeed.high;
    }

    if (command) {
      await this.performSend(command);
    }
  }

  getCharacteristicValue(characteristicType, subtype) {
    return this.state[subtype]?.[characteristicType] ?? false;
  }

  async setCharacteristicValue(characteristicType, subtype, value) {
    await catchDelayCancelError(async () => {
      if (!this.state[subtype]) this.state[subtype] = {};
      this.state[subtype][characteristicType] = value;

      const serviceManager = this.serviceManagers.find(sm => sm.displayName === subtype);
      if (!serviceManager) return;

      if (characteristicType === 'active' && serviceManager.type === 'valve') {
        this.state[subtype].inUse = value;
        serviceManager.setCharacteristic(this.Characteristic.InUse, value);
      }

      const data = serviceManager.data;
      let hexData;

      switch (characteristicType) {
        case 'switchState':
        case 'active':
          hexData = value ? data.on : data.off;
          break;
        case 'targetTemperature':
          await this.setTargetTemperature(null, null, subtype);
          return;
        case 'rotationSpeed':
          await this.setRotationSpeed(null, null, subtype);
          return;
      }

      if (hexData) {
        await this.performSend(hexData);
      }
    });
  }
}

module.exports = SmartToiletSeatAccessory;