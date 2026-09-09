import { readFileSync } from 'fs';
import { Application } from 'klayr-sdk';
import { PilotModule } from './modules/pilot/module';
import { CommunityModule } from './modules/community/module';
/* eslint-disable @typescript-eslint/no-empty-function */
import { AccountsModule } from "./modules/accounts/module";
import { CodaModule } from "./modules/coda/module";
import { PackageDataModule } from "./modules/package_data/module";
import { TrustfactsModule } from "./modules/trustfacts/module";

export const registerModules = (app: Application): void => {
    if (process.env.TRUSTSECO_PILOT === 'true') {
        if (!process.env.PILOT_GOVERNOR_FILE || !process.env.PILOT_NETWORK) throw new Error('Pilot governor and network are required');
        app.registerModule(new PilotModule(readFileSync(process.env.PILOT_GOVERNOR_FILE,'utf8'),process.env.PILOT_NETWORK));
    }
    if (process.env.TRUSTSECO_COMMUNITY_PROTOTYPE === 'true') {
        const key = process.env.COMMUNITY_GOVERNOR_FILE ? readFileSync(process.env.COMMUNITY_GOVERNOR_FILE, 'utf8') : process.env.COMMUNITY_GOVERNOR_KEY;
        if (!key) throw new Error('Community verification requires its genesis governor public key');
        const storageConfig = process.env.COMMUNITY_STORAGE_CONFIG ? JSON.parse(readFileSync(process.env.COMMUNITY_STORAGE_CONFIG, 'utf8')) as { activationHeight: number } : undefined;
        const storageHeight = Number(storageConfig?.activationHeight ?? process.env.COMMUNITY_STORAGE_HEIGHT ?? '0');
        if (!Number.isSafeInteger(storageHeight) || storageHeight < 0) throw new Error('Invalid community storage activation height');
        app.registerModule(new CommunityModule(key, storageHeight));
    }
    const accountsModule = new AccountsModule()
    app.registerModule(accountsModule);

    const packageDataModule = new PackageDataModule()
    app.registerModule(packageDataModule);

    const trustfactsModule = new TrustfactsModule()
    app.registerModule(trustfactsModule);

    const codaModule = new CodaModule();
    codaModule.addDependecies(accountsModule.method,packageDataModule.method, trustfactsModule.method);
    app.registerModule(codaModule);

    trustfactsModule.addDependecies(codaModule.method, accountsModule.method, packageDataModule.method);
};
