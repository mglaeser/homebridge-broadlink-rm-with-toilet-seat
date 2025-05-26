// accessories/smartToiletSeat.js

const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {
  constructor(log, config = {}) {
    if (!config.name) config.name = 'Smart Toilet Seat';

    // Konvertiere numerische Hex-Codes zu Strings
    SmartToiletSeat.convertConfigHexCodes(config);

    super(log, config);

    this.checkConfig(config);

    // Initialisiere den Zustand
    this.state = {
      powerState: false,
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false,
    };

    // Zeitüberschreitungen für Wasserfunktionen
    this.waterFunctionTimeouts = {};
  }

  static convertConfigHexCodes(config) {
    if (config.data) {
      Object.keys(config.data).forEach((key) => {
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

    const requiredCodes = [
      'powerOn',
      'powerOff',
      'powerSaveOn',
      'powerSaveOff',
      'showerOn',
      'showerOff',
      'bidetOn',
      'bidetOff',
      'dryOn',
      'dryOff',
    ];
    const missingCodes = requiredCodes.filter((code) => !data[code]);
    if (missingCodes.length > 0) {
      this.log(`${config.name} checkConfig: Missing hex codes: ${missingCodes.join(', ')}`);
    } else {
      this.log(`${config.name} checkConfig: All required hex codes found`);
    }
  }

  configureServiceManager() {
    const { data, name, log } = this;
    const { Service, Characteristic } = this;

    // Hauptstromversorgung (Switch)
    const powerService = new Service.Switch(`${name} Power`, 'power');
    powerService.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.powerState)
      .onSet(async (value) => {
        this.state.powerState = value;
        const hexData = value ? data.powerOn : data.powerOff;
        if (hexData) await this.performSend(hexData);
      });
    this.addService(powerService);

    // Energiesparmodus (Outlet)
    const powerSaveService = new Service.Outlet(`${name} Power Save`, 'powersave');
    powerSaveService.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.powerSaveState)
      .onSet(async (value) => {
        this.state.powerSaveState = value;
        const hexData = value ? data.powerSaveOn : data.powerSaveOff;
        if (hexData) await this.performSend(hexData);
      });
    powerSaveService.getCharacteristic(Characteristic.OutletInUse)
      .onGet(() => this.state.powerSaveState);
    this.addService(powerSaveService);

    // Dusche (Valve)
    const showerService = new Service.Valve(`${name} Shower`, 'shower');
    showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    showerService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.state.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        await this.setWaterFunction('shower', isActive);
      });
    showerService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.state.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    this.addService(showerService);

    // Bidet (Valve)
    const bidetService = new Service.Valve(`${name} Bidet`, 'bidet');
    bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    bidetService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.state.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        await this.setWaterFunction('bidet', isActive);
      });
    bidetService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.state.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    this.addService(bidetService);

    // Trockner (Fan)
    const dryService = new Service.Fan(`${name} Dry`, 'dry');
    dryService.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.dryActive)
      .onSet(async (value) => {
        this.state.dryActive = value;
        const hexData = value ? data.dryOn : data.dryOff;
        if (hexData) await this.performSend(hexData);
      });
    this.addService(dryService);
  }

  async setWaterFunction(functionType, active) {
    const { data, log, name } = this;
    const stateKey = `${functionType}Active`;
    const hexKey = `${functionType}${active ? 'On' : 'Off'}`;

    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      this.state[stateKey] = active;

      // Bestehenden Timeout löschen
      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }

      // Auto-Off für Wasserfunktionen (60 Sekunden)
      if (active) {
        log(`${name} ${functionType}: Auto-off in 60 seconds`);
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          this.state[stateKey] = false;
          await this.performSend(data[`${functionType}Off`]);
          delete this.waterFunctionTimeouts[functionType];

          // HomeKit aktualisieren
          const service = this.serviceManager.getService(functionType);
          if (service) {
            service.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
            service.updateCharacteristic(this.Characteristic.InUse, this.Characteristic.InUse.NOT_IN_USE);
          }
        }, 60000);
      }
    }
  }

  destroy() {
    Object.values(this.waterFunctionTimeouts).forEach((timeout) => {
      if (timeout) clearTimeout(timeout);
    });
    this.waterFunctionTimeouts = {};
  }
}

module.exports = SmartToiletSeat;