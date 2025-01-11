const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {
  serviceType() {
    return Service.Switch;
  }

  async setSwitchState(hexData, previousValue) {
    const { data, name, state, serviceManager } = this;
    
    // Ignore if no change
    if (state.switchState === previousValue) return;

    await this.performSend(hexData);
  }

  async setRotationSpeed(hexData, previousValue) {
    const { data, name, state } = this;
    const value = state.rotationSpeed;

    if (value <= 33) {
      await this.performSend(data.rotationSpeedLow);
    } else if (value <= 66) {
      await this.performSend(data.rotationSpeedMedium);
    } else {
      await this.performSend(data.rotationSpeedHigh);
    }
  }

  async setValveState(hexData, previousValue, valveType) {
    const { data, name, state, serviceManager } = this;
    const key = `valve${valveType}State`;

    if (state[key] === previousValue) return;

    await this.performSend(hexData);

    // Start auto-off timer if valve is turned on
    if (state[key]) {
      const duration = 60; // 60 seconds default duration
      this.startAutoOffTimer(valveType, duration);
    }
  }

  async setTemperature(hexData, previousValue, type) {
    const { data, name, state } = this;
    const key = `${type}Temperature`;
    const currentTemp = state[`${type}CurrentTemperature`] || 35;
    const targetTemp = state[`${type}TargetTemperature`];

    if (targetTemp > currentTemp) {
      await this.performSend(data[`${type}TemperatureUp`]);
    } else if (targetTemp < currentTemp) {
      await this.performSend(data[`${type}TemperatureDown`]);
    }

    // Update current temperature after a delay
    setTimeout(() => {
      state[`${type}CurrentTemperature`] = targetTemp;
      this.serviceManager.refreshCharacteristicUI(Characteristic.CurrentTemperature);
    }, 1000);
  }

  async startAutoOffTimer(valveType, duration) {
    const { name, serviceManager, state } = this;
    const key = `valve${valveType}State`;

    // Clear existing timeout
    if (this[`autoOffTimeout${valveType}`]) {
      clearTimeout(this[`autoOffTimeout${valveType}`]);
    }

    // Set new timeout
    this[`autoOffTimeout${valveType}`] = setTimeout(() => {
      state[key] = false;
      serviceManager.refreshCharacteristicUI(Characteristic.Active);
      serviceManager.refreshCharacteristicUI(Characteristic.InUse);
      
      // Send off command
      this.performSend(this.data[`valve${valveType}Off`]);
    }, duration * 1000);
  }

  configureServiceManager(serviceManager) {
    const { config, data } = this;
    
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

    // Power Save Mode
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

    // Dry Function (Fan)
    serviceManager.addToggleCharacteristic({
      name: 'dryState',
      type: Characteristic.On,
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
      name: 'rotationSpeed',
      type: Characteristic.RotationSpeed,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        setValuePromise: this.setRotationSpeed.bind(this)
      }
    });

    // Shower Valve
    serviceManager.addToggleCharacteristic({
      name: 'valveShowerState',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.showerOn,
        offData: data.showerOff,
        setValuePromise: (hexData, previousValue) => this.setValveState(hexData, previousValue, 'Shower')
      }
    });

    // Bidet Valve
    serviceManager.addToggleCharacteristic({
      name: 'valveBidetState',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.bidetOn,
        offData: data.bidetOff,
        setValuePromise: (hexData, previousValue) => this.setValveState(hexData, previousValue, 'Bidet')
      }
    });

    // Massage Valve
    serviceManager.addToggleCharacteristic({
      name: 'valveMassageState',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.massageOn,
        offData: data.massageOff,
        setValuePromise: (hexData, previousValue) => this.setValveState(hexData, previousValue, 'Massage')
      }
    });

    // Seat Temperature
    serviceManager.addToggleCharacteristic({
      name: 'seatCurrentTemperature',
      type: Characteristic.CurrentTemperature,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this
    });

    serviceManager.addToggleCharacteristic({
      name: 'seatTargetTemperature',
      type: Characteristic.TargetTemperature,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        setValuePromise: (hexData, previousValue) => this.setTemperature(hexData, previousValue, 'seat')
      }
    });

    // Water Temperature
    serviceManager.addToggleCharacteristic({
      name: 'waterCurrentTemperature',
      type: Characteristic.CurrentTemperature,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this
    });

    serviceManager.addToggleCharacteristic({
      name: 'waterTargetTemperature',
      type: Characteristic.TargetTemperature,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        setValuePromise: (hexData, previousValue) => this.setTemperature(hexData, previousValue, 'water')
      }
    });
  }
}

module.exports = SmartToiletSeat;