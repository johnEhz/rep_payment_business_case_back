import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async onModuleInit() {
    await this.seedProducts();
  }

  async findAll(): Promise<Product[]> {
    return this.productRepository.find({
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    return product;
  }

  /**
   * Decrementa el stock dentro de una transacción de BD
   */
  async decrementStockTransactional(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<Product> {
    const product = await manager.findOne(Product, {
      where: { id: productId },
      lock: { mode: 'pessimistic_write' },
    });

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

  /**
   * Semilla inicial con productos para el showcase de la tienda
   */
  private async seedProducts() {
    try {
      const count = await this.productRepository.count();
      if (count === 0) {
        this.logger.log('Seeding initial products catalogue...');
        const initialProducts = this.productRepository.create([
          {
            name: 'Auriculares Inalámbricos Pro Sound',
            description: 'Auriculares Bluetooth con cancelación activa de ruido, 30h de batería y sonido envolvente de alta fidelidad.',
            priceInCents: 15000000, // $150.000 COP
            stock: 12,
            imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80',
          },
          {
            name: 'Smartwatch Titan Edition',
            description: 'Reloj inteligente con monitor de ritmo cardíaco, GPS integrado, resistente al agua 50m y pantalla AMOLED.',
            priceInCents: 28000000, // $280.000 COP
            stock: 8,
            imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80',
          },
          {
            name: 'Teclado Mecánico RGB Custom',
            description: 'Teclado mecánico con switches intercambiables en caliente, teclas PBT de doble inyección y retroiluminación RGB.',
            priceInCents: 21000000, // $210.000 COP
            stock: 5,
            imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&auto=format&fit=crop&q=80',
          },
        ]);

        await this.productRepository.save(initialProducts);
        this.logger.log('Initial products created successfully.');
      }
    } catch (error: any) {
      this.logger.warn(`Could not seed products automatically: ${error?.message || error}`);
    }
  }
}
