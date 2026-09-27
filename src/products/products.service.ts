import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { Product } from './entities/product.entity';
import {
  StockReservation,
  ReservationStatus,
} from '../inventory/entities/stock-reservation.entity';
import {
  ProductResponseDto,
  ProductDetailResponseDto,
  PaginatedProductsResponseDto,
  toProductResponseDto,
  toProductDetailResponseDto,
} from './dto/product-response.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(filters?: {
    categoryId?: string;
    brandId?: string;
    category?: string;
    brand?: string;
    search?: string;
    page?: number;
    limit?: number;
    minPrice?: number;
    maxPrice?: number;
    inStockOnly?: boolean;
  }): Promise<PaginatedProductsResponseDto> {
    const page = Math.max(1, Number(filters?.page || 1));
    const limit = Math.max(1, Math.min(100, Number(filters?.limit || 12)));
    const skip = (page - 1) * limit;

    const qb = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.brand', 'brand')
      .orderBy('product.createdAt', 'ASC');

    if (filters?.categoryId) {
      qb.andWhere('product.categoryId = :categoryId', { categoryId: filters.categoryId });
    }
    if (filters?.category) {
      qb.andWhere('(category.slug = :cat OR LOWER(category.name) = LOWER(:cat))', { cat: filters.category });
    }
    if (filters?.brandId) {
      qb.andWhere('product.brandId = :brandId', { brandId: filters.brandId });
    }
    if (filters?.brand) {
      qb.andWhere('(brand.slug = :brand OR LOWER(brand.name) = LOWER(:brand))', { brand: filters.brand });
    }
    if (filters?.search && filters.search.trim()) {
      qb.andWhere('(LOWER(product.name) LIKE LOWER(:s) OR LOWER(product.description) LIKE LOWER(:s))', {
        s: `%${filters.search.trim()}%`,
      });
    }
    if (typeof filters?.minPrice === 'number' && !isNaN(filters.minPrice)) {
      qb.andWhere('product.priceInCents >= :minPrice', { minPrice: filters.minPrice });
    }
    if (typeof filters?.maxPrice === 'number' && !isNaN(filters.maxPrice)) {
      qb.andWhere('product.priceInCents <= :maxPrice', { maxPrice: filters.maxPrice });
    }
    if (filters?.inStockOnly) {
      qb.andWhere('product.stock > 0');
    }

    const [products, total] = await qb
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (products.length === 0) {
      return {
        data: [],
        total,
        page,
        limit,
        totalPages,
      };
    }

    // Calcular el stock disponible en tiempo real descontando reservas activas vigentes
    const now = new Date();
    const productIds = products.map((p) => p.id);
    const activeReservations = await this.dataSource
      .getRepository(StockReservation)
      .createQueryBuilder('r')
      .select('r.productId', 'productId')
      .addSelect('SUM(r.quantity)', 'totalReserved')
      .where('r.status = :status', { status: ReservationStatus.ACTIVE })
      .andWhere('r.expiresAt > :now', { now })
      .andWhere('r.productId IN (:...productIds)', { productIds })
      .groupBy('r.productId')
      .getRawMany();

    const reservedMap = new Map<string, number>();
    for (const r of activeReservations) {
      reservedMap.set(r.productId, Number(r.totalReserved || 0));
    }

    const data = products.map((p) => {
      const reserved = reservedMap.get(p.id) || 0;
      const availableStock = Math.max(0, p.stock - reserved);
      return toProductResponseDto(p, availableStock);
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findOne(idOrSlug: string): Promise<ProductDetailResponseDto> {
    const product = await this.findEntityByIdOrSlug(idOrSlug);
    const now = new Date();
    const activeReserved = await this.dataSource
      .getRepository(StockReservation)
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.quantity), 0)', 'total')
      .where('r.productId = :productId', { productId: product.id })
      .andWhere('r.status = :status', { status: ReservationStatus.ACTIVE })
      .andWhere('r.expiresAt > :now', { now })
      .getRawOne();

    const reserved = Number(activeReserved?.total || 0);
    const availableStock = Math.max(0, product.stock - reserved);
    return toProductDetailResponseDto(product, availableStock);
  }

  async findEntityByIdOrSlug(idOrSlug: string): Promise<Product> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const where = isUuid
      ? [{ id: idOrSlug }, { slug: idOrSlug }]
      : [{ slug: idOrSlug }, { name: idOrSlug }];

    const product = await this.productRepository.findOne({
      where,
      relations: { category: true, brand: true },
    });
    if (!product) {
      throw new NotFoundException(`Product "${idOrSlug}" not found`);
    }
    return product;
  }

  async findEntityById(id: string): Promise<Product> {
    return this.findEntityByIdOrSlug(id);
  }

  /**
   * Decrementa el stock dentro de una transacción de BD
   */
  async decrementStockTransactional(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<Product> {
    const product = await manager
      .createQueryBuilder(Product, 'p')
      .setLock('pessimistic_write')
      .where('p.id = :id', { id: productId })
      .getOne();

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    if (product.stock < quantity) {
      throw new BadRequestException(
        `Insufficient stock for product ${product.name}. Available: ${product.stock}, Requested: ${quantity}`,
      );
    }

    product.stock -= quantity;
    return manager.save(Product, product);
  }
}
