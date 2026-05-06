import { Global, Module } from '@nestjs/common';
import { StoreService } from './store.service';

// @Global() makes StoreService available throughout the app
// without needing to import StoreModule in each feature module.
@Global()
@Module({
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
