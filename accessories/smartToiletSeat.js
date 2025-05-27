const { Service, Characteristic } = require('hap-nodejs');
const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {

  serviceType() { return Service.Switch }

  constructor(log, config = {}) {
    if (!config.name) config.name = "Smart Toilet Seat";

    SmartToiletSeat.convertConfigHexCodes(config);
    super(log, config);

    this.checkConfig(config);

    this.state = { switchState: false };
    this.toiletState = {
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false
    };

    this.waterFunctionTimeouts = {};
  }

  static convertConfigHexCodes(config) {
    if (config.data) {
      Object.keys(config.data).forEach(key => {
        if (typeof config.data[key] === 'number') {
          config.data[key] = config.data[key].toString();
        }
      });
    }
  }

  checkConfig(config) {
    const { data } = config;
    if (!data) {
      this.log(`${config.name} checkConfig: No data found in config`);
      return;
    }

    const requiredCodes = ['powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff', 'showerOn', 'showerOff', 'bidetOn', 'bidetOff', 'dryOn', 'dryOff'];
    const missingCodes = requiredCodes.filter(code => !data[code]);
    if (missingCodes.length > 0) {
      this.log(`${config.name} checkConfig: Missing hex codes: ${missingCodes.join(', ')}`);
    } else {
      this.log(`${config.name} checkConfig: All required hex codes found`);
    }
  }

  async setWaterFunction(functionType, active) {
    const { data, log, name } = this;
    const stateKey = `${functionType}Active`;
    const hexKey = `${functionType}${active ? 'On' : 'Off'}`;

    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      this.toiletState[stateKey] = active;

      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }

      if (active) {
        log(`${name} ${functionType}: Auto-off in 60 seconds`);
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          this.toiletState[stateKey] = false;
          await this.performSend(data[`${functionType}Off`]);
          delete this.waterFunctionTimeouts[functionType];

          const services = this.getServices();
          const service = services.find(s => s.subtype === functionType);
          if (service) {
            service.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
            service.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
          }
        }, 60000);
      }
    }
  }

  getServices() {
    const { config, name, log } = this;
    const { data } = config;
    const services = [];

    // Get service names from config with fallbacks
    const serviceNames = {
      power: config.powerName || 'Power',
      powerSave: config.powerSaveName || 'Power Save', 
      shower: config.showerName || 'Shower',
      bidet: config.bidetName || 'Bidet',
      dry: config.dryName || 'Dry'
    };

    const accessoryInformation = new Service.AccessoryInformation();
    accessoryInformation
      .setCharacteristic(Characteristic.Manufacturer, 'Smart Toilet')
      .setCharacteristic(Characteristic.Model, 'Toilet Seat')
      .setCharacteristic(Characteristic.SerialNumber, 'STS-001');
    services.push(accessoryInformation);

    // 1. Power
    const powerService = new Service.Switch(serviceNames.power, 'power');
    powerService.setPrimaryService(true);
    powerService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getPowerState: ${this.state.switchState}`);
        return this.state.switchState;
      })
      .onSet(async (value) => {
        log(`${name} setPowerState: ${value}`);
        this.state.switchState = value;
        const hexData = value ? data.powerOn : data.powerOff;
        if (hexData) await this.performSend(hexData);
      });
    services.push(powerService);

    // 2. Power Save
    const powerSaveService = new Service.Outlet(serviceNames.powerSave, 'powersave');
    powerSaveService.getCharacteristic(Characteristic.On)
      .onGet(() => this.toiletState.powerSaveState)
      .onSet(async (value) => {
        log(`${name} setPowerSaveState: ${value}`);
        this.toiletState.powerSaveState = value;
        const hexData = value ? data.powerSaveOn : data.powerSaveOff;
        if (hexData) await this.performSend(hexData);
      });
    powerSaveService.getCharacteristic(Characteristic.OutletInUse)
      .onGet(() => this.toiletState.powerSaveState);
    services.push(powerSaveService);

    // 3. Shower
    const showerService = new Service.Valve(serviceNames.shower, 'shower');
    showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    showerService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.toiletState.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        log(`${name} setShowerActive: ${isActive}`);
        await this.setWaterFunction('shower', isActive);
      });
    showerService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    services.push(showerService);

    // 4. Bidet
    const bidetService = new Service.Valve(serviceNames.bidet, 'bidet');
    bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    bidetService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        log(`${name} setBidetActive: ${isActive}`);
        await this.setWaterFunction('bidet', isActive);
      });
    bidetService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    services.push(bidetService);

    // 5. Dry
    const dryService = new Service.Fan(serviceNames.dry, 'dry');
    dryService.getCharacteristic(Characteristic.On)
      .onGet(() => this.toiletState.dryActive)
      .onSet(async (value) => {
        log(`${name} setDryActive: ${value}`);
        this.toiletState.dryActive = value;
        const hexData = value ? data.dryOn : data.dryOff;
        if (hexData) await this.performSend(hexData);

        if (value) {
          setTimeout(() => {
            this.toiletState.dryActive = false;
            dryService.updateCharacteristic(Characteristic.On, false);
          }, 60000);
        }
      });
    services.push(dryService);

    return services;
  }

  // Required by homebridge-platform-helper but not used since we override getServices
  configureServiceManager(serviceManager) {
    // Empty - we use getServices() instead
  }

  destroy() {
    Object.values(this.waterFunctionTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.waterFunctionTimeouts = {};
  }
}

module.exports = SmartToiletSeat;