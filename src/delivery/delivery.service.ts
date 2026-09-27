import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { IDeliveryFeeCalculator } from './interfaces/delivery-calculator.interface';
import { Delivery, DeliveryStatus } from './entities/delivery.entity';

// Delimitación geográfica estricta del Área Metropolitana de Medellín (Valle de Aburrá)
// Cobertura: Medellín, Bello, Envigado, Itagüí, Sabaneta, La Estrella, Caldas, Copacabana, Girardota, Barbosa
export const MEDELLIN_METRO_BOUNDS = {
  minLng: -75.67,
  minLat: 6.06,
  maxLng: -75.32,
  maxLat: 6.45,
};

export function isWithinMedellinMetro(lng: number, lat: number): boolean {
  return (
    lng >= MEDELLIN_METRO_BOUNDS.minLng &&
    lng <= MEDELLIN_METRO_BOUNDS.maxLng &&
    lat >= MEDELLIN_METRO_BOUNDS.minLat &&
    lat <= MEDELLIN_METRO_BOUNDS.maxLat
  );
}

export interface DeliveryCalculationResult {
  distanceKm: number;
  distanceCostInCents: number;
  valueCostInCents: number;
  subtotalInCents: number;
  discountInCents: number;
  finalDeliveryFeeInCents: number;
  destinationCoordinates?: { latitude: number; longitude: number };
  geocodedAddress?: string;
  appliedRules: {
    distanceRule: string;
    valueRule: string;
    discountRule: string;
  };
}

@Injectable()
export class DeliveryService implements IDeliveryFeeCalculator {
  private readonly logger = new Logger(DeliveryService.name);
  private readonly mapboxToken: string;
  private readonly storeLatitude: number;
  private readonly storeLongitude: number;
  private readonly storeAddress: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectRepository(Delivery)
    private readonly deliveryRepository: Repository<Delivery>,
  ) {
    this.mapboxToken = this.configService.get<string>('MAPBOX_ACCESS_TOKEN', '');
    this.storeLatitude = Number(this.configService.get<number>('STORE_LATITUDE', 6.276887801451292));
    this.storeLongitude = Number(this.configService.get<number>('STORE_LONGITUDE', -75.58433727052517));
    this.storeAddress = this.configService.get<string>(
      'STORE_ADDRESS',
      'Cra 73B #75-171, Medellín, Robledo, Medellín, Antioquia',
    );
  }

  /**
   * Geocodifica una dirección física a coordenadas [lat, lng] usando Mapbox Geocoding API
   */
  async geocodeAddress(
    address: string,
    city = 'Medellín',
  ): Promise<{ latitude: number; longitude: number; placeName?: string } | null> {
    if (!this.mapboxToken || this.mapboxToken.startsWith('your_')) {
      this.logger.debug('Mapbox access token is not configured. Using fallback location.');
      return null;
    }

    try {
      const fullQuery = `${address}, ${city}, Antioquia, Colombia`;
      const bboxStr = `${MEDELLIN_METRO_BOUNDS.minLng},${MEDELLIN_METRO_BOUNDS.minLat},${MEDELLIN_METRO_BOUNDS.maxLng},${MEDELLIN_METRO_BOUNDS.maxLat}`;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        fullQuery
      )}.json?access_token=${this.mapboxToken}&country=CO&bbox=${bboxStr}&limit=1`;
      const response = await firstValueFrom(this.httpService.get(url));

      const features = response.data?.features;
      if (features && features.length > 0) {
        const [lng, lat] = features[0].center;
        if (!isWithinMedellinMetro(lng, lat)) {
          this.logger.warn(`Dirección geocodificada fuera del Valle de Aburrá: [${lng}, ${lat}]`);
          return null;
        }
        return {
          latitude: lat,
          longitude: lng,
          placeName: features[0].place_name,
        };
      }
      return null;
    } catch (error: any) {
      this.logger.warn(`Mapbox geocoding error for "${address}, ${city}": ${error?.message || error}`);
      return null;
    }
  }

  /**
   * Calcula la distancia de ruta en kilómetros usando Mapbox Directions API,
   * con respaldo de fórmula Haversine en caso de fallo o ausencia de token.
   */
  async calculateDistanceKm(
    destinationLat: number,
    destinationLng: number,
  ): Promise<number> {
    if (this.mapboxToken && !this.mapboxToken.startsWith('your_')) {
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${this.storeLongitude},${this.storeLatitude};${destinationLng},${destinationLat}?access_token=${this.mapboxToken}&overview=false`;
        const response = await firstValueFrom(this.httpService.get(url));

        const route = response.data?.routes?.[0];
        if (route && typeof route.distance === 'number') {
          const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
          return distanceKm;
        }
      } catch (error: any) {
        this.logger.warn(`Mapbox directions error: ${error?.message || error}. Falling back to Haversine.`);
      }
    }

    // Respaldo geométrico: Haversine distance * factor de corrección urbana (1.35)
    return this.haversineDistanceKm(
      this.storeLatitude,
      this.storeLongitude,
      destinationLat,
      destinationLng,
    );
  }

  private haversineDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightKm = R * c;
    const roadKm = straightKm * 1.35;
    return Math.max(0.5, Math.round(roadKm * 10) / 10);
  }

  getDistanceCost(distanceKm: number): { costInCents: number; rule: string } {
    if (distanceKm <= 2) {
      return { costInCents: 400000, rule: '0–2 km: $4.000' };
    }
    if (distanceKm <= 5) {
      return { costInCents: 600000, rule: '2–5 km: $6.000' };
    }
    if (distanceKm <= 8) {
      return { costInCents: 800000, rule: '5–8 km: $8.000' };
    }
    if (distanceKm <= 12) {
      return { costInCents: 1100000, rule: '8–12 km: $11.000' };
    }
    return { costInCents: 1500000, rule: '12+ km: $15.000' };
  }

  getValueCost(purchaseInCents: number): { costInCents: number; rule: string } {
    const purchaseInCop = purchaseInCents / 100;
    if (purchaseInCop < 30000) {
      return { costInCents: 700000, rule: 'Compra < $30.000: $7.000' };
    }
    if (purchaseInCop <= 60000) {
      return { costInCents: 500000, rule: '$30.000–$60.000: $5.000' };
    }
    return { costInCents: 0, rule: '> $60.000: $0' };
  }

  applyPurchaseDiscount(
    subtotalInCents: number,
    purchaseInCents: number,
  ): { finalDeliveryFeeInCents: number; discountInCents: number; rule: string } {
    const purchaseInCop = purchaseInCents / 100;

    if (purchaseInCop >= 300000) {
      return {
        finalDeliveryFeeInCents: 0,
        discountInCents: subtotalInCents,
        rule: 'Compra >= $300.000: 100% de descuento (Envío Gratis)',
      };
    }

    if (purchaseInCop >= 150000) {
      const discounted = Math.round(subtotalInCents * 0.5);
      return {
        finalDeliveryFeeInCents: discounted,
        discountInCents: subtotalInCents - discounted,
        rule: 'Compra >= $150.000: 50% de descuento en el delivery',
      };
    }

    return {
      finalDeliveryFeeInCents: subtotalInCents,
      discountInCents: 0,
      rule: 'Sin descuento por compra (< $150.000)',
    };
  }

  async calculateDeliveryFee(
    totalPurchaseAmountInCents: number,
    address?: string,
    city = 'Medellín',
    providedCoords?: { latitude: number; longitude: number },
  ): Promise<DeliveryCalculationResult> {
    if (address && address.trim().length > 0 && address.trim().length < 5) {
      throw new BadRequestException('Ingresa una dirección de entrega válida (mínimo 5 caracteres).');
    }

    let coords: { latitude: number; longitude: number } | null = providedCoords || null;
    let geocodedAddress: string | undefined;

    if (!coords && address && address.trim().length >= 5) {
      const geoResult = await this.geocodeAddress(address, city);
      if (geoResult) {
        coords = { latitude: geoResult.latitude, longitude: geoResult.longitude };
        geocodedAddress = geoResult.placeName;
      }
    }

    if (coords && !isWithinMedellinMetro(coords.longitude, coords.latitude)) {
      throw new BadRequestException(
        'La dirección de entrega seleccionada se encuentra fuera del Área Metropolitana de Medellín (Valle de Aburrá).'
      );
    }

    let distanceKm: number;
    if (coords) {
      distanceKm = await this.calculateDistanceKm(coords.latitude, coords.longitude);
    } else {
      distanceKm = city && (city.toLowerCase().includes('medell') || city.toLowerCase().includes('robledo')) ? 4.5 : 10.0;
    }

    const distancePricing = this.getDistanceCost(distanceKm);
    const valuePricing = this.getValueCost(totalPurchaseAmountInCents);
    const subtotalInCents = distancePricing.costInCents + valuePricing.costInCents;
    const discountResult = this.applyPurchaseDiscount(subtotalInCents, totalPurchaseAmountInCents);

    return {
      distanceKm,
      distanceCostInCents: distancePricing.costInCents,
      valueCostInCents: valuePricing.costInCents,
      subtotalInCents,
      discountInCents: discountResult.discountInCents,
      finalDeliveryFeeInCents: discountResult.finalDeliveryFeeInCents,
      destinationCoordinates: coords || undefined,
      geocodedAddress,
      appliedRules: {
        distanceRule: distancePricing.rule,
        valueRule: valuePricing.rule,
        discountRule: discountResult.rule,
      },
    };
  }

  /**
   * Crea el registro de Delivery al confirmarse el pago de la orden
   */
  async createDeliveryForOrder(
    manager: EntityManager,
    order: {
      id: string;
      deliveryAddress: string;
      deliveryCity: string;
      deliveryLatitude?: number;
      deliveryLongitude?: number;
      deliveryFeeAmount: number;
    },
  ): Promise<Delivery> {
    const existing = await manager.findOne(Delivery, { where: { orderId: order.id } });
    if (existing) {
      this.logger.log(`Delivery record already exists for order ${order.id}. Returning existing.`);
      return existing;
    }

    const estimatedDeliveryAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas estimadas

    const delivery = manager.create(Delivery, {
      orderId: order.id,
      address: order.deliveryAddress,
      city: order.deliveryCity || 'Medellín',
      latitude: order.deliveryLatitude,
      longitude: order.deliveryLongitude,
      feeAmount: order.deliveryFeeAmount,
      status: DeliveryStatus.DELIVERED,
      estimatedDeliveryAt,
      deliveredAt: new Date(),
    });

    const saved = await manager.save(Delivery, delivery);
    this.logger.log(`Created delivery record ${saved.id} for order ${order.id}`);
    return saved;
  }

  /**
   * Actualiza el estado logístico del envío
   */
  async updateStatus(
    deliveryId: string,
    status: DeliveryStatus,
    driverId?: string,
  ): Promise<Delivery> {
    const delivery = await this.deliveryRepository.findOne({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException(`Delivery with ID ${deliveryId} not found`);
    }

    delivery.status = status;
    if (driverId) delivery.assignedDriverId = driverId;
    if (status === DeliveryStatus.DELIVERED) {
      delivery.deliveredAt = new Date();
    }

    return this.deliveryRepository.save(delivery);
  }

  async findByOrderId(orderId: string): Promise<Delivery | null> {
    return this.deliveryRepository.findOne({ where: { orderId } });
  }
}
