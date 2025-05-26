const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {
  
  constructor(log, config = {}) {
    if (!config.name) config.name = "Smart Toilet Seat";
    super(log, config);

    this.manufacturer = 'Smart Toilet';
    this.model = 'Smart Toilet Seat';
    this.serialNumber = 'STS-001';

    this.checkConfig(config);
  }

  serviceType() {
    return Service.Switch;
  }

  setDefaults() {
    super.setDefaults();
    
    const { state } = this;

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

    this.autoOffTimeouts = {};
  }

  reset() {
    super.reset();

    Object.values(this.autoOffTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.autoOffTimeouts = {};
  }

  async performSetValueAction({ host, data, log, name }) {
    await this.performSend(data);
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
        offData: data.powerOff
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
        offData: data.powerSaveOff
      }
    });

    // Dry Function - Use separate get/set methods instead of addToggleCharacteristic
    serviceManager.addGetCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      method: this.getCharacteristicValue,
      bind: this
    });

    serviceManager.addSetCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      method: this.setCharacteristicValue,
      bind: this
    });

    // Dry Speed
    if (data.rotationSpeedLow || data.rotationSpeedMedium || data.rotationSpeedHigh) {
      serviceManager.addGetCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addSetCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        method: async (value, callback) => {
          this.state.dryRotationSpeed = value;
          
          if (value <= 33) await this.performSend(data.rotationSpeedLow);
          else if (value <= 66) await this.performSend(data.rotationSpeedMedium);
          else await this.performSend(data.rotationSpeedHigh);
          
          callback();
        },
        bind: this
      });
    }

    // Valves
    ['Shower', 'Bidet', 'Massage'].forEach((valveType) => {
      const activeKey = `valve${valveType}Active`;
      const lcType = valveType.toLowerCase();
      
      serviceManager.addGetCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addSetCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        method: async (value, callback) => {
          this.state[activeKey] = value;
          
          const hexData = value ? data[`${lcType}On`] : data[`${lcType}Off`];
          if (hexData) await this.performSend(hexData);
          
          // Handle auto-off
          if (value) {
            if (this.autoOffTimeouts[valveType]) {
              clearTimeout(this.autoOffTimeouts[valveType]);
            }

            this.autoOffTimeouts[valveType] = setTimeout(async () => {
              this.state[activeKey] = false;
              serviceManager.refreshCharacteristicUI(Characteristic.Active);
              if (data[`${lcType}Off`]) await this.performSend(data[`${lcType}Off`]);
            }, 60000);
          }
          
          callback();
        },
        bind: this
      });
    });

    // Temperatures
    ['seat', 'shower'].forEach(type => {
      const currentKey = `${type}CurrentTemperature`;
      const targetKey = `${type}TargetTemperature`;

      serviceManager.addGetCharacteristic({
        name: currentKey,
        type: Characteristic.CurrentTemperature,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addGetCharacteristic({
        name: targetKey,
        type: Characteristic.TargetTemperature,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addSetCharacteristic({
        name: targetKey,
        type: Characteristic.TargetTemperature,
        method: async (value, callback) => {
          const current = this.state[currentKey];
          this.state[targetKey] = value;

          if (value > current) {
            if (data[`${type}TempUp`]) await this.performSend(data[`${type}TempUp`]);
          } else if (value < current) {
            if (data[`${type}TempDown`]) await this.performSend(data[`${type}TempDown`]);
          }

          this.state[currentKey] = value;
          callback();
        },
        bind: this
      });

      serviceManager.addGetCharacteristic({
        name: `${type}DisplayUnits`,
        type: Characteristic.TemperatureDisplayUnits,
        method: (callback) => callback(null, 0), // 0 = Celsius
        bind: this
      });
    });
  }
}

module.exports = SmartToiletSeat;