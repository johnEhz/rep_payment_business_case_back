import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getTypeOrmConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USER', 'postgres'),
  password: configService.get<string>('DB_PASSWORD', 'postgres'),
  database: configService.get<string>('DB_NAME', 'store_db'),
  autoLoadEntities: true,
  synchronize: configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
  logging: configService.get<string>('NODE_ENV') === 'development',
  ssl:
    configService.get<string>('DB_SSL', 'false') === 'true' ||
    configService.get<string>('DB_HOST', '').includes('rds.amazonaws.com')
      ? { rejectUnauthorized: false }
      : false,
});
