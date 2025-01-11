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

    // Dry Function
    serviceManager.addToggleCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.dryOn,
        offData: data.dryOff
      }
    });

    // Dry Speed
    if (data.rotationSpeedLow || data.rotationSpeedMedium || data.rotationSpeedHigh) {
      serviceManager.addToggleCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: undefined,
          offData: undefined,
          setValuePromise: async (value) => {
            if (value <= 33) await this.performSend(data.rotationSpeedLow);
            else if (value <= 66) await this.performSend(data.rotationSpeedMedium);
            else await this.performSend(data.rotationSpeedHigh);
          }
        }
      });
    }

    // Valves
    ['Shower', 'Bidet', 'Massage'].forEach((valveType) => {
      const activeKey = `valve${valveType}Active`;
      const lcType = valveType.toLowerCase();
      
      serviceManager.addToggleCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: data[`${lcType}On`],
          offData: data[`${lcType}Off`],
          setValuePromise: async (hexData, previousValue) => {
            await this.performSend(hexData);
            
            // Handle auto-off
            if (this.state[activeKey]) {
              if (this.autoOffTimeouts[valveType]) {
                clearTimeout(this.autoOffTimeouts[valveType]);
              }

              this.autoOffTimeouts[valveType] = setTimeout(async () => {
                this.state[activeKey] = false;
                serviceManager.refreshCharacteristicUI(Characteristic.Active);
                await this.performSend(data[`${lcType}Off`]);
              }, 60000);
            }
          }
        }
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
          setValuePromise: async (hexData, previousValue) => {
            const current = this.state[currentKey];
            const target = this.state[targetKey];

            if (target > current) {
              await this.performSend(data[`${type}TempUp`]);
            } else if (target < current) {
              await this.performSend(data[`${type}TempDown`]);
            }

            this.state[currentKey] = target;
          }
        }
      });

      serviceManager.addToggleCharacteristic({
        name: `${type}DisplayUnits`,
        type: Characteristic.TemperatureDisplayUnits,
        getMethod: (callback) => callback(null, 0), // 0 = Celsius
        setMethod: (value, callback) => callback(),
        bind: this
      });
    });
  }
}

module.exports = SmartToiletSeat;