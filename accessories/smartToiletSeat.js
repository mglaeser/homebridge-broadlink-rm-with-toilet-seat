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

    Object.values(this.autoOffTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.autoOffTimeouts = {};
  }

  getCharacteristicValue(name) {
    return this.state[name];
  }

  setCharacteristicValue(name, value) {
    this.state[name] = value;
  }

  async setSwitchState(hexData, previousValue) {
    const { log, name, state } = this;
    if (state.switchState === previousValue) return;
    
    log(`${name} setSwitchState: ${state.switchState}`);
    await this.performSend(hexData);
  }

  async setRotationSpeed(hexData, previousValue) {
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

  async setValveState(hexData, previousValue, valveType) {
    const { log, name, state, serviceManager } = this;
    const stateKey = `valve${valveType}Active`;

    if (state[stateKey] === previousValue) return;

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

  async setTemperature(hexData, previousValue, type) {
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
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
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
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
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
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
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
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
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
      
      serviceManager.addToggleCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: data[`${valveType.toLowerCase()}On`],
          offData: data[`${valveType.toLowerCase()}Off`],
          setValuePromise: (hexData, previousValue) => this.setValveState(hexData, previousValue, valveType)
        }
      });

      serviceManager.addToggleCharacteristic({
        name: `valve${valveType}Type`,
        type: Characteristic.ValveType,
        getMethod: () => (valveType === 'Shower' ? 3 : 1),
        setMethod: () => {},
        bind: this
      });

      serviceManager.addToggleCharacteristic({
        name: `valve${valveType}Duration`,
        type: Characteristic.SetDuration,
        getMethod: () => 60,
        setMethod: () => {},
        bind: this
      });
    });

    // Temperatures
    ['seat', 'shower'].forEach(type => {
      const currentKey = `${type}CurrentTemperature`;
      const targetKey = `${type}TargetTemperature`;

      serviceManager.addToggleCharacteristic({
        name: currentKey,
        type: Characteristic.CurrentTemperature,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
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
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 0.5,
          setValuePromise: (hexData, previousValue) => this.setTemperature(hexData, previousValue, type)
        }
      });

      serviceManager.addToggleCharacteristic({
        name: `${type}DisplayUnits`,
        type: Characteristic.TemperatureDisplayUnits,
        getMethod: () => Characteristic.TemperatureDisplayUnits.CELSIUS,
        setMethod: () => {},
        bind: this
      });
    });
  }
}

module.exports = SmartToiletSeat;