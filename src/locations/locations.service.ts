import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from './entities/country.entity';
import { Department } from './entities/department.entity';
import { City } from './entities/city.entity';

@Injectable()
export class LocationsService implements OnModuleInit {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    @InjectRepository(Country)
    private readonly countryRepo: Repository<Country>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(City)
    private readonly cityRepo: Repository<City>,
  ) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  private async seedDefaults() {
    // 1. Seed Colombia
    const co = await this.countryRepo.findOne({ where: { code: 'CO' } });
    if (!co) {
      await this.countryRepo.save({
        code: 'CO',
        name: 'Colombia',
        phonePrefix: '+57',
      });
      this.logger.log('Seeded default country: Colombia (CO)');
    }

    // 2. Seed Antioquia
    const ant = await this.departmentRepo.findOne({ where: { code: 'ANT' } });
    if (!ant) {
      await this.departmentRepo.save({
        code: 'ANT',
        name: 'Antioquia',
        countryCode: 'CO',
      });
      this.logger.log('Seeded default department: Antioquia (ANT)');
    }

    // 3. Seed Medellín Metropolitan Area municipalities
    const metroCities = [
      { code: 'MED', name: 'Medellín', departmentCode: 'ANT' },
      { code: 'BEL', name: 'Bello', departmentCode: 'ANT' },
      { code: 'ENV', name: 'Envigado', departmentCode: 'ANT' },
      { code: 'ITA', name: 'Itagüí', departmentCode: 'ANT' },
      { code: 'SAB', name: 'Sabaneta', departmentCode: 'ANT' },
      { code: 'EST', name: 'La Estrella', departmentCode: 'ANT' },
      { code: 'CAL', name: 'Caldas', departmentCode: 'ANT' },
      { code: 'COP', name: 'Copacabana', departmentCode: 'ANT' },
      { code: 'GIR', name: 'Girardota', departmentCode: 'ANT' },
      { code: 'BAR', name: 'Barbosa', departmentCode: 'ANT' },
    ];

    for (const cityData of metroCities) {
      const existing = await this.cityRepo.findOne({ where: { code: cityData.code } });
      if (!existing) {
        await this.cityRepo.save(cityData);
      }
    }
  }

  async getCountries(): Promise<Country[]> {
    return this.countryRepo.find({ order: { name: 'ASC' } });
  }

  async getDepartments(countryCode = 'CO'): Promise<Department[]> {
    return this.departmentRepo.find({
      where: { countryCode: countryCode.toUpperCase() },
      order: { name: 'ASC' },
    });
  }

  async getCities(departmentCode = 'ANT'): Promise<City[]> {
    return this.cityRepo.find({
      where: { departmentCode: departmentCode.toUpperCase() },
      order: { name: 'ASC' },
    });
  }

  /**
   * Valida que el país, departamento y municipio pertenezcan estrictamente al Área Metropolitana de Medellín (Valle de Aburrá)
   */
  async validateSupportedLocation(
    countryNameOrCode?: string,
    deptNameOrCode?: string,
    cityNameOrCode?: string,
  ): Promise<{ country: string; department: string; city: string }> {
    const country = countryNameOrCode?.trim() || 'Colombia';
    const department = deptNameOrCode?.trim() || 'Antioquia';
    const city = cityNameOrCode?.trim() || 'Medellín';

    const isCountryValid = ['CO', 'COLOMBIA'].includes(country.toUpperCase());
    const isDeptValid = ['ANT', '05', 'ANTIOQUIA'].includes(department.toUpperCase());

    const normalize = (t: string) =>
      t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

    const allowedCities = [
      'MEDELLIN',
      'MED',
      '05001',
      'BELLO',
      'BEL',
      'ENVIGADO',
      'ENV',
      'ITAGUI',
      'ITA',
      'SABANETA',
      'SAB',
      'LA ESTRELLA',
      'ESTRELLA',
      'EST',
      'CALDAS',
      'CAL',
      'COPACABANA',
      'COP',
      'GIRARDOTA',
      'GIR',
      'BARBOSA',
      'BAR',
    ];

    const normalizedCity = normalize(city);
    const isCityValid = allowedCities.some(
      (ac) => normalizedCity === ac || normalizedCity.includes(ac) || ac.includes(normalizedCity)
    );

    if (!isCountryValid) {
      throw new BadRequestException(`País "${country}" no soportado. Actualmente solo operamos en Colombia.`);
    }

    if (!isDeptValid) {
      throw new BadRequestException(`Departamento "${department}" no soportado. Actualmente solo operamos en Antioquia.`);
    }

    if (!isCityValid) {
      throw new BadRequestException(
        `Ciudad "${city}" fuera de cobertura. Solo realizamos envíos en el Área Metropolitana de Medellín (Valle de Aburrá).`
      );
    }

    return {
      country: 'Colombia',
      department: 'Antioquia',
      city,
    };
  }
}
