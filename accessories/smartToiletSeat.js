const BroadlinkRMAccessory = require('./accessory');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');

class SmartToiletSeat extends BroadlinkRMAccessory {
  serviceType() {
    return Service.Switch;
  }

  constructor(log, config = {}) {
    super(log, config);
    
    this.state = {
      switchState: false,
      powerSaveState: false,
      dryActive: false,
      dryRotationSpeed: 0,
      valveShowerActive: false,
      valveBidetActive: false,
      valveMassageActive: false,
      valveShowerType: 3,
      valveBidetType: 1,
      valveMassageType: 1,
      valveShowerDuration: 60,
      valveBidetDuration: 60,
      valveMassageDuration: 60,
      seatCurrentTemperature: 35,
      seatTargetTemperature: 35,
      seatDisplayUnits: 0,
      showerCurrentTemperature: 35,
      showerTargetTemperature: 35,
      showerDisplayUnits: 0
    };

    this.autoOffTimeouts = {};
  }

  reset() {
    super.reset();

    Object.values(this.autoOffTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.autoOffTimeouts = {};
  }

  getCharacteristicValue(name, callback) {
    const value = this.state[name] ?? false;
    callback(null, value);
  }

  setCharacteristicValue(name, value, callback) {
    this.state[name] = value;
    callback();
  }

  async setSwitchState(hexData) {
    const { log, name, state } = this;
    log(`${name} setSwitchState: ${state.switchState}`);
    await this.performSend(hexData);
  }

  async setRotationSpeed(hexData) {
    const { data, log, name, state } = this;
    const speed = state.dryRotationSpeed;

    let speedHexData;
    if (speed <= 33) speedHexData = data.rotationSpeedLow;
    else if (speed <= 66) speedHexData = data.rotationSpeedMedium;
    else speedHexData = data.rotationSpeedHigh;

    if (speedHexData) {
      log(`${name} setRotationSpeed: ${speed}%`);
      await this.performSend(speedHexData);
    }
  }

  async setValveState(hexData, _, valveType) {
    const { log, name, state, serviceManager } = this;
    const stateKey = `valve${valveType}Active`;

    log(`${name} set${valveType}State: ${state[stateKey]}`);
    await this.performSend(hexData);

    if (state[stateKey]) {
      if (this.autoOffTimeouts[valveType]) {
        clearTimeout(this.autoOffTimeouts[valveType]);
      }

      this.autoOffTimeouts[valveType] = setTimeout(async () => {
        state[stateKey] = false;
        serviceManager.refreshCharacteristicUI(Characteristic.Active);
        
        const offData = this.data[`${valveType.toLowerCase()}Off`];
        if (offData) await this.performSend(offData);
      }, 60000);
    }
  }

  async setTemperature(hexData, _, type) {
    const { data, log, name, state } = this;
    const currentKey = `${type}CurrentTemperature`;
    const targetKey = `${type}TargetTemperature`;

    if (state[targetKey] > state[currentKey]) {
      await this.performSend(data[`${type}TempUp`]);
    } else if (state[targetKey] < state[currentKey]) {
      await this.performSend(data[`${type}TempDown`]);
    }

    state[currentKey] = state[targetKey];
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Power Switch
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue.bind(this, 'switchState'),
      setMethod: this.setCharacteristicValue.bind(this, 'switchState'),
      bind: this,
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
      getMethod: this.getCharacteristicValue.bind(this, 'powerSaveState'),
      setMethod: this.setCharacteristicValue.bind(this, 'powerSaveState'),
      bind: this,
      props: {
        onData: data.powerSaveOn,
        offData: data.powerSaveOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Dry Function
    serviceManager.addToggleCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue.bind(this, 'dryActive'),
      setMethod: this.setCharacteristicValue.bind(this, 'dryActive'),
      bind: this,
      props: {
        onData: data.dryOn,
        offData: data.dryOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    serviceManager.addToggleCharacteristic({
      name: 'dryRotationSpeed',
      type: Characteristic.RotationSpeed,
      getMethod: this.getCharacteristicValue.bind(this, 'dryRotationSpeed'),
      setMethod: this.setCharacteristicValue.bind(this, 'dryRotationSpeed'),
      bind: this,
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
      const typeKey = `valve${valveType}Type`;
      const durationKey = `valve${valveType}Duration`;
      
      serviceManager.addToggleCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        getMethod: this.getCharacteristicValue.bind(this, activeKey),
        setMethod: this.setCharacteristicValue.bind(this, activeKey),
        bind: this,
        props: {
          onData: data[`${valveType.toLowerCase()}On`],
          offData: data[`${valveType.toLowerCase()}Off`],
          setValuePromise: (hexData) => this.setValveState(hexData, null, valveType)
        }
      });

      serviceManager.addToggleCharacteristic({
        name: typeKey,
        type: Characteristic.ValveType,
        getMethod: this.getCharacteristicValue.bind(this, typeKey),
        setMethod: this.setCharacteristicValue.bind(this, typeKey),
        bind: this
      });

      serviceManager.addToggleCharacteristic({
        name: durationKey,
        type: Characteristic.SetDuration,
        getMethod: this.getCharacteristicValue.bind(this, durationKey),
        setMethod: this.setCharacteristicValue.bind(this, durationKey),
        bind: this
      });
    });

    // Temperatures
    ['seat', 'shower'].forEach(type => {
      const currentKey = `${type}CurrentTemperature`;
      const targetKey = `${type}TargetTemperature`;
      const unitsKey = `${type}DisplayUnits`;

      serviceManager.addToggleCharacteristic({
        name: currentKey,
        type: Characteristic.CurrentTemperature,
        getMethod: this.getCharacteristicValue.bind(this, currentKey),
        setMethod: this.setCharacteristicValue.bind(this, currentKey),
        bind: this,
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 0.5
        }
      });

      serviceManager.addToggleCharacteristic({
        name: targetKey,
        type: Characteristic.TargetTemperature,
        getMethod: this.getCharacteristicValue.bind(this, targetKey),
        setMethod: this.setCharacteristicValue.bind(this, targetKey),
        bind: this,
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 0.5,
          setValuePromise: (hexData) => this.setTemperature(hexData, null, type)
        }
      });

      serviceManager.addToggleCharacteristic({
        name: unitsKey,
        type: Characteristic.TemperatureDisplayUnits,
        getMethod: this.getCharacteristicValue.bind(this, unitsKey),
        setMethod: this.setCharacteristicValue.bind(this, unitsKey),
        bind: this
      });
    });
  }
}

module.exports = SmartToiletSeat;