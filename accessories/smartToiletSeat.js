const { Service, Characteristic } = require('hap-nodejs');
const BroadlinkRMAccessory = require('./accessory');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');

class SmartToiletSeatAccessory extends BroadlinkRMAccessory {
  constructor(log, config) {
    super(log, config);

    this.state = {}; // To track the state of each characteristic
    this.serviceManagers = [];
    const { services } = config;

    // Initialize each service from the configuration
    services.forEach((serviceConfig) => this.createServiceManager(serviceConfig));
  }

  serviceType() {
    return Service.Switch; // Default type (updated dynamically for each service)
  }

  createServiceManager(serviceConfig) {
    const { type, subtype, displayName, characteristics, data } = serviceConfig;

    const service = new Service[type](displayName, subtype);
    const serviceManager = this.addService(service);

    // Save IR codes (data) for use in performSendCommand
    serviceManager.data = data;

    characteristics.forEach((characteristicConfig) => {
      const { type, value } = characteristicConfig;

      serviceManager.addToggleCharacteristic({
        name: `${subtype}-${type}`,
        type: Characteristic[type],
        getMethod: this.getCharacteristicValue.bind(this, type, subtype),
        setMethod: this.setCharacteristicValue.bind(this, type, subtype),
        props: {
          defaultValue: value,
        },
      });
    });

    this.serviceManagers.push(serviceManager);
  }

  async setCharacteristicValue(characteristicType, subtype, value) {
    if (!this.state[subtype]) this.state[subtype] = {};
    this.state[subtype][characteristicType] = value;

    this.log(`Set ${characteristicType} for ${subtype} to ${value}`);

    await this.performSendCommand(characteristicType, subtype, value);

    this.checkAutoOnOff(subtype);
  }

  getCharacteristicValue(characteristicType, subtype) {
    const currentValue = this.state?.[subtype]?.[characteristicType];
    this.log(`Getting value for ${subtype}-${characteristicType}: ${currentValue}`);
    return currentValue ?? null;
  }

  async performSendCommand(characteristicType, subtype, value) {
    const serviceManager = this.serviceManagers.find((sm) => sm.subtype === subtype);

    if (!serviceManager || !serviceManager.data) {
      this.log(`No IR data found for ${subtype}-${characteristicType}`);
      return;
    }

    let command = null;

    if (characteristicType === 'On') {
      command = value ? serviceManager.data.on : serviceManager.data.off;
    } else if (characteristicType === 'RotationSpeed') {
      const rotationSpeed = value;
      this.state[subtype].RotationSpeed = rotationSpeed;

      if (rotationSpeed <= 33) {
        command = serviceManager.data.rotationSpeed?.low;
      } else if (rotationSpeed <= 66) {
        command = serviceManager.data.rotationSpeed?.medium;
      } else {
        command = serviceManager.data.rotationSpeed?.high;
      }

      this.log(`Rotation speed for ${subtype}: ${rotationSpeed}% (mapped to ${command ? 'valid command' : 'no command'})`);
    }

    if (command) {
      this.log(`Sending IR command for ${subtype}-${characteristicType}: ${command}`);
      await this.performSend(command);
    } else {
      this.log(`No command found for ${subtype}-${characteristicType}`);
    }
  }

  checkAutoOnOff(subtype) {
    const serviceManager = this.serviceManagers.find((sm) => sm.subtype === subtype);
    if (!serviceManager) return;

    this.resetAutoTimers(subtype);
    this.checkAutoOn(subtype, serviceManager);
    this.checkAutoOff(subtype, serviceManager);
  }

  resetAutoTimers(subtype) {
    if (this.autoOffTimeoutPromise?.[subtype]) {
      this.autoOffTimeoutPromise[subtype].cancel();
      this.autoOffTimeoutPromise[subtype] = null;
    }
    if (this.autoOnTimeoutPromise?.[subtype]) {
      this.autoOnTimeoutPromise[subtype].cancel();
      this.autoOnTimeoutPromise[subtype] = null;
    }
  }

  async checkAutoOff(subtype, serviceManager) {
    const { config } = this;
    const { enableAutoOff, onDuration } = config;

    if (this.state[subtype]?.switchState && enableAutoOff) {
      this.log(`Auto-off enabled for ${subtype}, turning off in ${onDuration}s`);

      this.autoOffTimeoutPromise[subtype] = delayForDuration(onDuration);
      await this.autoOffTimeoutPromise[subtype];

      serviceManager.setCharacteristic(Characteristic.On, false);
    }
  }

  async checkAutoOn(subtype, serviceManager) {
    const { config } = this;
    const { enableAutoOn, offDuration } = config;

    if (!this.state[subtype]?.switchState && enableAutoOn) {
      this.log(`Auto-on enabled for ${subtype}, turning on in ${offDuration}s`);

      this.autoOnTimeoutPromise[subtype] = delayForDuration(offDuration);
      await this.autoOnTimeoutPromise[subtype];

      serviceManager.setCharacteristic(Characteristic.On, true);
    }
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue.bind(this, 'switchState', serviceManager.subtype),
      setMethod: this

.setCharacteristicValue.bind(this, 'switchState', serviceManager.subtype),
      props: {
        onData: data.on,
        offData: data.off,
        setValuePromise: this.setCharacteristicValue.bind(this),
      },
    });

    if (data.rotationSpeed) {
      serviceManager.addToggleCharacteristic({
        name: 'fanSpeed',
        type: Characteristic.RotationSpeed,
        getMethod: this.getCharacteristicValue.bind(this, 'RotationSpeed', serviceManager.subtype),
        setMethod: this.setCharacteristicValue.bind(this, 'RotationSpeed', serviceManager.subtype),
        props: {
          setValuePromise: this.setCharacteristicValue.bind(this),
        },
      });
    }
  }
}

module.exports = SmartToiletSeatAccessory;