const BroadlinkRMAccessory = require('./accessory');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');

class SmartToiletSeat extends BroadlinkRMAccessory {
  serviceType() {
    return Service.Switch;
  }

  constructor(log, config = {}) {
    super(log, config);

    // Initialize state
    this.state = {
      switchState: false,
      powerSaveState: false,
      dryActive: false,
      dryRotationSpeed: 0,
      valveShowerActive: false,
      valveBidetActive: false,
      valveMassageActive: false,
      seatCurrentTemperature: 35,
      seatTargetTemperature: 35,
      showerCurrentTemperature: 35,
      showerTargetTemperature: 35
    };

    // Timers object for valves auto-off
    this.autoOffTimeouts = {};
  }

  reset() {
    super.reset();

    // Clear all auto-off timeouts
    Object.values(this.autoOffTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.autoOffTimeouts = {};
  }

  async setSwitchState(hexData, previousValue) {
    const { log, name, state } = this;

    if (state.switchState === previousValue) return;

    log(`${name} setSwitchState: ${state.switchState}`);
    await this.performSend(hexData);
  }

  async setValveState(hexData, previousValue, valveType) {
    const { log, name, state, serviceManager } = this;
    const stateKey = `valve${valveType}Active`;

    // Only proceed if state has actually changed
    if (state[stateKey] === previousValue) return;

    log(`${name} set${valveType}State: ${state[stateKey]}`);

    await this.performSend(hexData);

    // Set up auto-off timer if valve is turned on
    if (state[stateKey]) {
      // Clear existing timeout if any
      if (this.autoOffTimeouts[valveType]) {
        clearTimeout(this.autoOffTimeouts[valveType]);
      }

      // Set new timeout
      this.autoOffTimeouts[valveType] = setTimeout(async () => {
        state[stateKey] = false;
        serviceManager.refreshCharacteristicUI(Characteristic.Active);
        
        const offData = this.data[`${valveType.toLowerCase()}Off`];
        if (offData) await this.performSend(offData);
      }, 60000); // 60 second auto-off
    }
  }

  async setRotationSpeed(hexData) {
    const { log, name, state } = this;
    const speed = state.dryRotationSpeed;

    let speedData;
    if (speed <= 33) speedData = this.data.rotationSpeedLow;
    else if (speed <= 66) speedData = this.data.rotationSpeedMedium;
    else speedData = this.data.rotationSpeedHigh;

    if (speedData) {
      log(`${name} setRotationSpeed: ${speed}%`);
      await this.performSend(speedData);
    }
  }

  async setTemperature(hexData, previousValue, type) {
    const { log, name, state } = this;
    const currentKey = `${type}CurrentTemperature`;
    const targetKey = `${type}TargetTemperature`;

    log(`${name} set${type}Temperature: ${state[targetKey]}°C`);

    if (state[targetKey] > state[currentKey]) {
      await this.performSend(this.data[`${type}TempUp`]);
    } else if (state[targetKey] < state[currentKey]) {
      await this.performSend(this.data[`${type}TempDown`]);
    }

    state[currentKey] = state[targetKey];
  }

  getCharacteristicValue(name, callback) {
    const { state } = this;
    callback(null, state[name]);
  }

  setCharacteristicValue(name, value, callback) {
    this.state[name] = value;
    callback();
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Power Switch
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: (callback) => this.getCharacteristicValue('switchState', callback),
      setMethod: (value, callback) => this.setCharacteristicValue('switchState', value, callback),
      props: {
        onData: data.powerOn,
        offData: data.powerOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Power Save
    serviceManager.addToggleCharacteristic({
      name: 'powerSaveState',
      type: Characteristic.On,
      getMethod: (callback) => this.getCharacteristicValue('powerSaveState', callback),
      setMethod: (value, callback) => this.setCharacteristicValue('powerSaveState', value, callback),
      props: {
        onData: data.powerSaveOn,
        offData: data.powerSaveOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Dry Fan
    serviceManager.addToggleCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      getMethod: (callback) => this.getCharacteristicValue('dryActive', callback),
      setMethod: (value, callback) => this.setCharacteristicValue('dryActive', value, callback),
      props: {
        onData: data.dryOn,
        offData: data.dryOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    serviceManager.addToggleCharacteristic({
      name: 'dryRotationSpeed',
      type: Characteristic.RotationSpeed,
      getMethod: (callback) => this.getCharacteristicValue('dryRotationSpeed', callback),
      setMethod: (value, callback) => this.setCharacteristicValue('dryRotationSpeed', value, callback),
      props: {
        minValue: 0,
        maxValue: 100,
        minStep: 1,
        setValuePromise: this.setRotationSpeed.bind(this)
      }
    });

    // Valves
    ['Shower', 'Bidet', 'Massage'].forEach((valveType) => {
      const activeKey = `valve${valveType}Active`;
      
      serviceManager.addToggleCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        getMethod: (callback) => this.getCharacteristicValue(activeKey, callback),
        setMethod: (value, callback) => this.setCharacteristicValue(activeKey, value, callback),
        props: {
          onData: data[`${valveType.toLowerCase()}On`],
          offData: data[`${valveType.toLowerCase()}Off`],
          setValuePromise: (hexData, previousValue) => this.setValveState(hexData, previousValue, valveType)
        }
      });

      serviceManager.addToggleCharacteristic({
        name: `valve${valveType}Type`,
        type: Characteristic.ValveType,
        getMethod: (callback) => callback(null, valveType === 'Shower' ? 3 : 1),
        setMethod: (value, callback) => callback()
      });
    });

    // Temperatures
    ['seat', 'shower'].forEach(type => {
      const currentKey = `${type}CurrentTemperature`;
      const targetKey = `${type}TargetTemperature`;

      serviceManager.addToggleCharacteristic({
        name: currentKey,
        type: Characteristic.CurrentTemperature,
        getMethod: (callback) => this.getCharacteristicValue(currentKey, callback),
        setMethod: (value, callback) => this.setCharacteristicValue(currentKey, value, callback),
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 0.5
        }
      });

      serviceManager.addToggleCharacteristic({
        name: targetKey,
        type: Characteristic.TargetTemperature,
        getMethod: (callback) => this.getCharacteristicValue(targetKey, callback),
        setMethod: (value, callback) => this.setCharacteristicValue(targetKey, value, callback),
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 0.5,
          setValuePromise: (hexData, previousValue) => this.setTemperature(hexData, previousValue, type)
        }
      });
    });
  }
}

module.exports = SmartToiletSeat;