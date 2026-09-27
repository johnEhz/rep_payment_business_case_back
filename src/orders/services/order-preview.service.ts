import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InventoryService } from '../../inventory/inventory.service';
import { LocationsService } from '../../locations/locations.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { PricingService } from '../../products/services/pricing.service';
import { CheckoutPreviewDto } from '../dto/checkout-preview.dto';

@Injectable()
export class OrderPreviewService {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly locationsService: LocationsService,
    private readonly deliveryService: DeliveryService,
    private readonly pricingService: PricingService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Cotización y validación previa del carrito con verificación reactiva de stock y desglose tributario
   */
  async previewCheckout(dto: CheckoutPreviewDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Cart items cannot be empty');
    }

    // 1. Validación reactiva de disponibilidad de stock
    const validatedItems = await this.inventoryService.validateCartStock(dto.items);

    // 2. Cálculo tributario y de precios vigentes por línea
    const itemBreakdowns = await Promise.all(
      validatedItems.map(async (vi) => {
        const pricing = await this.pricingService.calculateItemPrice(vi.product, vi.quantity);
        return {
          ...pricing,
          imageUrl: vi.product.imageUrl,
          availableStock: vi.availableStock,
        };
      }),
    );

    const subtotalAmount = itemBreakdowns.reduce((acc, i) => acc + i.subtotal, 0); // Base antes de IVA
    const taxAmount = itemBreakdowns.reduce((acc, i) => acc + i.taxAmount, 0); // IVA total liquidado
    const productsTotalAmount = itemBreakdowns.reduce((acc, i) => acc + i.totalAmount, 0); // Total comercial productos

    // 3. Validación de ubicación geográfica soportada
    const validLoc = await this.locationsService.validateSupportedLocation(
      dto.deliveryCountry,
      dto.deliveryDepartment,
      dto.deliveryCity,
    );

    // 4. Cálculo dinámico de delivery mediante geocodificación y distancias
    const deliveryCalc = await this.deliveryService.calculateDeliveryFee(
      productsTotalAmount,
      dto.deliveryAddress,
      validLoc.city,
      dto.deliveryLatitude && dto.deliveryLongitude
        ? { latitude: dto.deliveryLatitude, longitude: dto.deliveryLongitude }
        : undefined,
    );

    const baseFeeAmount = Number(this.configService.get<number>('BASE_FEE_IN_CENTS', 300000));
    const discountAmount = Number(deliveryCalc.discountInCents || 0);
    const deliveryFeeAmount = Number(deliveryCalc.finalDeliveryFeeInCents);
    const totalAmount = productsTotalAmount + deliveryFeeAmount + baseFeeAmount;

    return {
      subtotalAmount, // Base gravable total sin IVA
      productsTotalAmount, // Subtotal comercial de productos (Base + IVA)
      feeAmount: baseFeeAmount,
      deliveryFeeAmount,
      discountAmount,
      taxAmount, // Total IVA
      totalAmount,
      currency: 'COP',
      deliveryEstimate: {
        distanceKm: deliveryCalc.distanceKm,
        distanceCostInCents: deliveryCalc.distanceCostInCents,
        valueCostInCents: deliveryCalc.valueCostInCents,
        discountInCents: deliveryCalc.discountInCents,
        appliedRules: deliveryCalc.appliedRules,
      },
      items: itemBreakdowns.map((ib) => ({
        productId: ib.productId,
        productName: ib.productName,
        unitPrice: ib.unitPrice,
        unitBasePrice: ib.unitBasePrice,
        taxRate: ib.taxRate,
        taxAmount: ib.taxAmount,
        subtotal: ib.subtotal,
        quantity: ib.quantity,
        totalAmount: ib.totalAmount,
        imageUrl: ib.imageUrl,
        availableStock: ib.availableStock,
        taxCategoryName: ib.taxCategoryName,
        taxCategoryCode: ib.taxCategoryCode,
      })),
    };
  }
}
