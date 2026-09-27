import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual, IsNull } from 'typeorm';
import { Product } from '../entities/product.entity';
import { ProductPrice } from '../entities/product-price.entity';
import { TaxCategory } from '../../taxes/entities/tax-category.entity';
import { TaxesService } from '../../taxes/taxes.service';

export interface CalculatedItemPrice {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number; // Precio comercial final por unidad (ej: 119.000)
  unitBasePrice: number; // Precio base antes de impuesto por unidad (ej: 100.000)
  taxRate: number; // Tasa de impuesto (ej: 19)
  taxAmount: number; // Impuesto total de la línea ((unitPrice - unitBasePrice) * quantity)
  subtotal: number; // Base imponible total de la línea (unitBasePrice * quantity)
  totalAmount: number; // Total comercial de la línea (unitPrice * quantity)
  taxIncluded: boolean;
  taxCategoryName: string;
  taxCategoryCode: string;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectRepository(ProductPrice)
    private readonly priceRepository: Repository<ProductPrice>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly taxesService: TaxesService,
  ) {}

  /**
   * Obtiene el precio comercial activo y vigente para un producto
   */
  async getActivePrice(productId: string): Promise<ProductPrice | null> {
    const now = new Date();

    const price = await this.priceRepository
      .createQueryBuilder('p')
      .where('p.productId = :productId', { productId })
      .andWhere('p.isActive = :isActive', { isActive: true })
      .andWhere('p.validFrom <= :now', { now })
      .andWhere('(p.validTo IS NULL OR p.validTo >= :now)', { now })
      .orderBy('p.validFrom', 'DESC')
      .addOrderBy('p.createdAt', 'DESC')
      .getOne();

    return price;
  }

  /**
   * Obtiene la categoría tributaria del producto o el IVA estándar 19% por defecto
   */
  async getTaxCategory(product: Product): Promise<TaxCategory> {
    if (product.taxCategory) {
      return product.taxCategory;
    }

    if (product.taxCategoryId) {
      try {
        return await this.taxesService.findById(product.taxCategoryId);
      } catch {
        // Fallback a impuesto general
      }
    }

    return this.taxesService.getDefaultTaxCategory();
  }

  /**
   * Calcula el desglose tributario exacto (Base + IVA + Total) para una línea de compra
   */
  async calculateItemPrice(product: Product, quantity = 1): Promise<CalculatedItemPrice> {
    const activePrice = await this.getActivePrice(product.id);
    const taxCategory = await this.getTaxCategory(product);

    // Precio final comercial por unidad (en centavos de COP)
    const finalUnitPrice = activePrice
      ? Number(activePrice.price)
      : Number(product.priceInCents);

    const taxIncluded = activePrice ? activePrice.taxIncluded : true;
    const taxRate = Number(taxCategory.rate || 0);

    let unitBasePrice: number;
    let unitTaxAmount: number;

    if (taxRate === 0) {
      // Exento o tarifa 0%
      unitBasePrice = finalUnitPrice;
      unitTaxAmount = 0;
    } else if (taxIncluded) {
      // Precio publicado ya incluye IVA:
      // Base = Precio / (1 + rate / 100)
      unitBasePrice = Math.round(finalUnitPrice / (1 + taxRate / 100));
      unitTaxAmount = finalUnitPrice - unitBasePrice;
    } else {
      // Precio no incluye IVA:
      unitBasePrice = finalUnitPrice;
      unitTaxAmount = Math.round(unitBasePrice * (taxRate / 100));
    }

    const subtotal = unitBasePrice * quantity;
    const taxAmount = unitTaxAmount * quantity;
    const totalAmount = (unitBasePrice + unitTaxAmount) * quantity;

    return {
      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice: unitBasePrice + unitTaxAmount,
      unitBasePrice,
      taxRate,
      taxAmount,
      subtotal,
      totalAmount,
      taxIncluded,
      taxCategoryName: taxCategory.name,
      taxCategoryCode: taxCategory.code,
    };
  }

  /**
   * Crea un nuevo precio para un producto manteniendo el histórico
   */
  async createPrice(
    productId: string,
    priceInCents: number,
    taxIncluded = true,
    validFrom = new Date(),
    currency = 'COP',
  ): Promise<ProductPrice> {
    // Cerrar vigencia del precio activo previo si no tiene validTo
    const currentActive = await this.getActivePrice(productId);
    if (currentActive && (!currentActive.validTo || currentActive.validTo > validFrom)) {
      currentActive.validTo = validFrom;
      await this.priceRepository.save(currentActive);
    }

    const newPrice = this.priceRepository.create({
      productId,
      price: priceInCents,
      currency,
      taxIncluded,
      validFrom,
      validTo: null,
      isActive: true,
    });

    const savedPrice = await this.priceRepository.save(newPrice);

    // Sincronizar el campo priceInCents en la tabla products como cache rápido
    await this.productRepository.update(productId, { priceInCents });

    return savedPrice;
  }
}
