const ServiceManagerTypes = require('../helpers/serviceManagerTypes');
const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeatAccessory extends BroadlinkRMAccessory {

  constructor(log, config = {}, serviceManagerType) {
    // Set default name if not provided
    if (!config.name) config.name = "Smart Toilet Seat";

    super(log, config, serviceManagerType);

    // Initialize toilet-specific state
    this.toiletState = {
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false
    };
  }

  setDefaults() {
    super.setDefaults();
    
    // Set default power state to ON (before loadState runs)
    // This will be the default for new installations
    // loadState() will override this if there's saved state
    this.state.switchState = true;
  }

  reset() {
    super.reset();
  }

  // Getter method for outlet characteristic
  getOutletInUse(callback) {
    // OutletInUse should return true when the outlet is in use (powered on)
    callback(null, this.state.switchState || false);
  }

  // Main power handler - ONLY CHANGE: Added minimal smart logic
  async setPowerState(hexData, previousValue) {
    const { config, state, log, name, logLevel } = this;
    
    try {
      // ✅ MINIMAL SMART LOGIC: Only send IR if power state actually changed
      const newPowerState = state.switchState;
      const actuallyChanged = previousValue !== newPowerState;
      
      if (!actuallyChanged) {
        if (logLevel <= 3) {
          log(`${name} Power: already ${newPowerState ? 'ON' : 'OFF'} (no IR command sent)`);
        }
        return; // Skip sending IR command
      }

      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} Power: ${state.switchState ? 'ON' : 'OFF'}`);
        }
      }

      // If turning OFF main power, turn off all other functions in UI/state only
      // DON'T send OFF IR commands - the toilet seat handles this automatically
      if (!state.switchState) {
        if (logLevel <= 2) {
          log(`${name} Main power OFF - turning off all functions (UI only, no IR commands)`);
        }
        
        // Turn off all toilet function states
        this.toiletState.powerSaveState = false;
        this.toiletState.showerActive = false;
        this.toiletState.bidetActive = false;
        this.toiletState.dryActive = false;

        // Update all service characteristics (UI only)
        this.serviceManagers.forEach(service => {
          if (service.subtype === 'powersave') {
            service.updateCharacteristic(Characteristic.On, false);
          } else if (service.subtype === 'shower' || service.subtype === 'bidet') {
            service.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
            service.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
          } else if (service.subtype === 'dry') {
            service.updateCharacteristic(Characteristic.On, false);
          }
        });
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Power control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Unified function handler for shower, bidet, and dry - ALWAYS send codes (multiple levels)
  async setWaterFunction(functionType, active) {
    const { config, log, name, logLevel, data } = this;
    const stateKey = `${functionType}Active`;
    
    try {
      this.toiletState[stateKey] = active;
      const hexData = active ? data[`${functionType}On`] : data[`${functionType}Off`];
      
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} ${functionType}: ${active ? 'ON' : 'OFF'}`);
        }
      }

      // If turning ON this function, turn OFF the other water/dry functions (UI only)
      // DON'T send OFF IR commands - the toilet seat handles switching automatically
      if (active) {
        const otherFunctions = ['shower', 'bidet', 'dry'].filter(f => f !== functionType);
        
        for (const otherFunction of otherFunctions) {
          if (this.toiletState[`${otherFunction}Active`]) {
            if (logLevel <= 2) {
              log(`${name} ${functionType} ON - turning off ${otherFunction} (UI only, seat handles IR automatically)`);
            }
            
            // Update internal state
            this.toiletState[`${otherFunction}Active`] = false;
            
            // Update other service UI
            const otherService = this.serviceManagers.find(s => s.subtype === otherFunction);
            if (otherService) {
              if (otherFunction === 'dry') {
                otherService.updateCharacteristic(Characteristic.On, false);
              } else {
                otherService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
                otherService.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
              }
            }
          }
        }
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} ${functionType} control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Follow TV accessory pattern for multiple services - UNCHANGED
  getServices() {
    const services = this.getInformationServices();
    
    // Add primary service (via ServiceManager)
    services.push(this.serviceManager.service);
    
    // Add additional services (manual services)
    services.push(...this.serviceManagers);
    
    return services;
  }

  // Primary service via ServiceManager + additional services manually - MINIMAL CHANGES
  setupServiceManager() {
    const { data, name, config, serviceManagerType, log, logLevel } = this;
    
    // Validate data exists
    if (!data) {
      const message = `${name}: No data configuration provided`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    const { 
      powerOn, powerOff, powerSaveOn, powerSaveOff, 
      showerOn, showerOff, bidetOn, bidetOff, 
      dryOn, dryOff 
    } = data;

    // Validate required hex codes
    const requiredCodes = {
      powerOn: 'Main power on',
      powerOff: 'Main power off', 
      powerSaveOn: 'Power save on',
      powerSaveOff: 'Power save off',
      showerOn: 'Shower on',
      showerOff: 'Shower off',
      bidetOn: 'Bidet on', 
      bidetOff: 'Bidet off',
      dryOn: 'Dry on',
      dryOff: 'Dry off'
    };
    
    const missingCodes = Object.keys(requiredCodes).filter(code => !data[code]);
    if (missingCodes.length > 0) {
      const missing = missingCodes.map(code => requiredCodes[code]).join(', ');
      const message = `${name}: Missing required hex codes: ${missing}`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    try {
      // 1. PRIMARY SERVICE via ServiceManager (like TV accessory does)
      this.serviceManager = new ServiceManagerTypes[serviceManagerType](name, Service.Outlet, this.log);
      
      this.serviceManager.addToggleCharacteristic({
        name: 'switchState',
        type: Characteristic.On,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: powerOn,
          offData: powerOff,
          setValuePromise: this.setPowerState.bind(this)
        }
      });

      // Add OutletInUse characteristic for Outlet service
      this.serviceManager.addGetCharacteristic({
        name: 'outletInUse',
        type: Characteristic.OutletInUse,
        method: this.getOutletInUse,
        bind: this
      });

      // 2. ADDITIONAL SERVICES manually (like TV accessory does)
      this.serviceManagers = [];

      // Get service names from config
      const serviceNames = {
        powerSave: config.powerSaveName || 'Power Save',
        shower: config.showerName || 'Shower',
        bidet: config.bidetName || 'Bidet',
        dry: config.dryName || 'Dry',
        stop: config.stopButtonName || 'Stop'  // ✅ FIXED: Add stop button name
      };

      // Power Save Switch - ONLY CHANGE: Added smart logic
      const powerSaveService = new Service.Switch(serviceNames.powerSave, 'powersave');
      powerSaveService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      powerSaveService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.powerSave);
      powerSaveService.getCharacteristic(Characteristic.On)
        .onGet(() => this.toiletState.powerSaveState)
        .onSet(async (value) => {
          try {
            // ✅ MINIMAL SMART LOGIC: Only send IR if power save state changed
            const previousState = this.toiletState.powerSaveState;
            const actuallyChanged = previousState !== value;
            
            if (!actuallyChanged) {
              if (logLevel <= 3) {
                log(`${name} Power Save: already ${value ? 'ON' : 'OFF'} (no IR command sent)`);
              }
              return;
            }

            this.toiletState.powerSaveState = value;
            const hexData = value ? data.powerSaveOn : data.powerSaveOff;
            if (hexData) {
              await this.performSend(hexData);
            }
            if (logLevel <= 2) {
              log(`${name} Power Save: ${value ? 'ON' : 'OFF'}`);
            }
          } catch (error) {
            log(`${name} Power Save error: ${error.message}`);
          }
        });
      this.serviceManagers.push(powerSaveService);

      // Shower Valve - UNCHANGED
      const showerService = new Service.Valve(serviceNames.shower, 'shower');
      showerService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      showerService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.shower);
      showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
      showerService.getCharacteristic(Characteristic.Active)
        .onGet(() => this.toiletState.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
        .onSet(async (value) => {
          const isActive = value === Characteristic.Active.ACTIVE;
          await this.setWaterFunction('shower', isActive);
        });
      showerService.getCharacteristic(Characteristic.InUse)
        .onGet(() => this.toiletState.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
      this.serviceManagers.push(showerService);

      // Bidet Valve - UNCHANGED
      const bidetService = new Service.Valve(serviceNames.bidet, 'bidet');
      bidetService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      bidetService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.bidet);
      bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
      bidetService.getCharacteristic(Characteristic.Active)
        .onGet(() => this.toiletState.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
        .onSet(async (value) => {
          const isActive = value === Characteristic.Active.ACTIVE;
          await this.setWaterFunction('bidet', isActive);
        });
      bidetService.getCharacteristic(Characteristic.InUse)
        .onGet(() => this.toiletState.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
      this.serviceManagers.push(bidetService);

      // Dry Fan - UNCHANGED
      const dryService = new Service.Fan(serviceNames.dry, 'dry');
      dryService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      dryService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.dry);
      dryService.getCharacteristic(Characteristic.On)
        .onGet(() => this.toiletState.dryActive)
        .onSet(async (value) => {
          // Use the same unified logic for mutual exclusion
          await this.setWaterFunction('dry', value);
        });
      this.serviceManagers.push(dryService);

// ✅ FIXED: Stop Button with proper stateless behavior
if (data.stopAll) {
  const stopService = new Service.Switch(serviceNames.stop, 'stop');
  stopService.addOptionalCharacteristic(Characteristic.ConfiguredName);
  stopService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.stop);
  
  stopService.getCharacteristic(Characteristic.On)
    .onGet(() => false) // Always return OFF (stateless button)
    .onSet(async (value) => {
      try {
        if (value) { // Only act when turned ON
          if (logLevel <= 2) {
            log(`${name} Stop Button: Stopping all actions`);
          }
          
          // Send stop command first
          await this.performSend(data.stopAll);
          
          // ✅ FIXED: Update internal states
          this.toiletState.showerActive = false;
          this.toiletState.bidetActive = false;
          this.toiletState.dryActive = false;
          this.toiletState.powerSaveState = false;
          
          // ✅ FIXED: Update UIs using direct service references
          const powerSaveService = this.serviceManagers.find(s => s.subtype === 'powersave');
          const showerService = this.serviceManagers.find(s => s.subtype === 'shower');
          const bidetService = this.serviceManagers.find(s => s.subtype === 'bidet');
          const dryService = this.serviceManagers.find(s => s.subtype === 'dry');
          
          if (powerSaveService) {
            powerSaveService.updateCharacteristic(Characteristic.On, false);
            if (logLevel <= 1) log(`${name} Stop: Power Save UI updated`);
          }
          
          if (showerService) {
            showerService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
            showerService.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
            if (logLevel <= 1) log(`${name} Stop: Shower UI updated`);
          }
          
          if (bidetService) {
            bidetService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
            bidetService.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
            if (logLevel <= 1) log(`${name} Stop: Bidet UI updated`);
          }
          
          if (dryService) {
            dryService.updateCharacteristic(Characteristic.On, false);
            if (logLevel <= 1) log(`${name} Stop: Dry UI updated`);
          }
          
          // ✅ KEY FIX: Use setTimeout to reset button state after HomeKit UI updates
          setTimeout(() => {
            stopService.updateCharacteristic(Characteristic.On, false);
            if (logLevel <= 1) log(`${name} Stop: Button reset to OFF`);
          }, 100); // Small delay allows HomeKit to process the ON state first
        }
      } catch (error) {
        log(`${name} Stop Button error: ${error.message}`);
        // ✅ ALWAYS reset button to OFF with delay, even on error
        setTimeout(() => {
          stopService.updateCharacteristic(Characteristic.On, false);
        }, 100);
      }
    });
  
  this.serviceManagers.push(stopService);
  
  if (logLevel <= 2) {
    log(`${name}: Stop button "${serviceNames.stop}" added`);
  }
}

      // Final logging - MINIMAL CHANGE
      if (logLevel <= 2) {
        const additionalServices = [serviceNames.powerSave, serviceNames.shower, serviceNames.bidet, serviceNames.dry];
        if (data.stopAll) {
          additionalServices.push(serviceNames.stop + ' (button)');
        }
        
        log(`${name}: Successfully configured with ${this.serviceManagers.length + 1} services`);
        log(`${name}: Primary: ${name} (Outlet), Additional: ${additionalServices.join(', ')}`);
      }

    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Error setting up service managers: ${error.message}`);
      }
      throw error;
    }
  }
}

module.exports = SmartToiletSeatAccessory;