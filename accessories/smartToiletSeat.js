const BroadlinkRMAccessory = require('./accessory');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');

class SmartToiletSeat extends BroadlinkRMAccessory {
  serviceType() {
    return Service.Switch;  // Base type doesn't matter as we're using multiple services
  }

  setDefaults() {
    const { config, state } = this;
    
    // Set state default values
    state.switchState = false;
    state.powerSaveState = false;
    state.dryActive = false;
    state.dryRotationSpeed = 0;
    state.valveShowerActive = false;
    state.valveBidetActive = false;
    state.valveMassageActive = false;
    state.seatCurrentTemperature = 35;
    state.seatTargetTemperature = 35;
    state.showerCurrentTemperature = 35;
    state.showerTargetTemperature = 35;

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
        serviceManager.refreshCharacteristicUI(Characteristic.InUse);
        
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
    
    // Only proceed if target temperature has changed
    if (state[targetKey] === previousValue) return;

    log(`${name} set${type}Temperature: ${state[targetKey]}°C`);

    if (state[targetKey] > state[currentKey]) {
      await this.performSend(this.data[`${type}TempUp`]);
    } else if (state[targetKey] < state[currentKey]) {
      await this.performSend(this.data[`${type}TempDown`]);
    }

    // Update current temperature after a delay
    await delayForDuration(1);
    state[currentKey] = state[targetKey];
    this.serviceManager.refreshCharacteristicUI(Characteristic.CurrentTemperature);
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

    // Dry Fan
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

    if (data.rotationSpeedLow || data.rotationSpeedMedium || data.rotationSpeedHigh) {
      serviceManager.addToggleCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          setValuePromise: this.setRotationSpeed.bind(this)
        }
      });
    }

    // Valves
    ['Shower', 'Bidet', 'Massage'].forEach((valveType) => {
      serviceManager.addToggleCharacteristic({
        name: `valve${valveType}Active`,
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
        getMethod: () => valveType === 'Shower' ? 3 : 1,
        setMethod: () => {},
        bind: this
      });

      serviceManager.addToggleCharacteristic({
        name: `valve${valveType}SetDuration`,
        type: Characteristic.SetDuration,
        getMethod: () => 60,
        setMethod: () => {},
        bind: this
      });
    });

    // Temperatures
    ['seat', 'shower'].forEach(type => {
      serviceManager.addToggleCharacteristic({
        name: `${type}CurrentTemperature`,
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
        name: `${type}TargetTemperature`,
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