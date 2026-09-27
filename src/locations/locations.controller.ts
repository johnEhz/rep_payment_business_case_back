import { Controller, Get, Query } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('countries')
  async getCountries() {
    return this.locationsService.getCountries();
  }

  @Get('departments')
  async getDepartments(@Query('countryCode') countryCode?: string) {
    return this.locationsService.getDepartments(countryCode || 'CO');
  }

  @Get('cities')
  async getCities(@Query('departmentCode') departmentCode?: string) {
    return this.locationsService.getCities(departmentCode || 'ANT');
  }
}
