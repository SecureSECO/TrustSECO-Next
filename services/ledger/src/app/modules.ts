import { readFileSync } from 'fs';
import { Application } from 'klayr-sdk';
import { CommunityModule } from './modules/community/module';
/* eslint-disable @typescript-eslint/no-empty-function */
import { AccountsModule } from "./modules/accounts/module";
import { CodaModule } from "./modules/coda/module";
import { PackageDataModule } from "./modules/package_data/module";
import { TrustfactsModule } from "./modules/trustfacts/module";

export const registerModules = (app: Application): void => {
    if (process.env.TRUSTSECO_COMMUNITY_PROTOTYPE === 'true') {
        const key = process.env.COMMUNITY_GOVERNOR_FILE ? readFileSync(process.env.COMMUNITY_GOVERNOR_FILE, 'utf8') : process.env.COMMUNITY_GOVERNOR_KEY;
        if (!key) throw new Error('Community verification requires its genesis governor public key');
        app.registerModule(new CommunityModule(key));
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
