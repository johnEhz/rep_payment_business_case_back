import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Category } from '../categories/entities/category.entity';
import { Brand } from '../brands/entities/brand.entity';
import { Product, slugify } from '../products/entities/product.entity';
import { NotificationTemplate } from '../notifications/entities/notification-template.entity';
import { TaxCategory, TaxType } from '../taxes/entities/tax-category.entity';
import { ProductPrice } from '../products/entities/product-price.entity';

interface CategorySeedData {
  name: string;
  slug: string;
  description?: string;
}

interface BrandSeedData {
  name: string;
  slug: string;
  logoUrl?: string;
}

interface ProductSeedData {
  name: string;
  description: string;
  priceInCents: number;
  stock: number;
  imageUrl?: string;
  images?: string[];
  categorySlug?: string;
  brandSlug?: string;
}

interface TemplateSeedData {
  name: string;
  createdAt?: string;
}

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(NotificationTemplate)
    private readonly templateRepository: Repository<NotificationTemplate>,
    @InjectRepository(TaxCategory)
    private readonly taxCategoryRepository: Repository<TaxCategory>,
    @InjectRepository(ProductPrice)
    private readonly productPriceRepository: Repository<ProductPrice>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAll();
  }

  /**
   * Carga y parsea un archivo JSON de forma segura buscando en dist o src
   */
  private loadJsonData<T>(filename: string): T[] {
    const candidates = [
      path.join(__dirname, 'data', filename),
      path.join(process.cwd(), 'src', 'seeds', 'data', filename),
      path.join(process.cwd(), 'dist', 'seeds', 'data', filename),
    ];

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(content) as T[];
        } catch (error: any) {
          this.logger.error(`Error reading or parsing ${filePath}: ${error?.message || error}`);
        }
      }
    }

    this.logger.warn(`Could not find seed file "${filename}" in candidate paths.`);
    return [];
  }

  /**
   * Ejecuta el proceso ordenado de siembra desde los archivos JSON
   */
  async seedAll() {
    this.logger.log('Starting automated database seeding from JSON files...');
    try {
      const taxesCount = await this.seedTaxCategories();
      const categoriesCount = await this.seedCategories();
      const brandsCount = await this.seedBrands();
      const productsCount = await this.seedProducts();
      const templatesCount = await this.seedTemplates();

      this.logger.log(
        `Seeding finished successfully. Taxes: ${taxesCount}, Categories: ${categoriesCount}, Brands: ${brandsCount}, Products: ${productsCount}, Templates: ${templatesCount}.`,
      );
    } catch (error: any) {
      this.logger.error(`Database seeding encountered an error: ${error?.message || error}`);
    }
  }

  /**
   * 1. Semilla de Categorías Tributarias (IVA 19%, IVA 5%, Exento 0%)
   */
  private async seedTaxCategories(): Promise<number> {
    const defaultCategories = [
      { name: 'IVA General 19%', code: 'VAT_19', rate: 19.0, type: TaxType.VAT, isActive: true },
      { name: 'IVA Reducido 5%', code: 'VAT_5', rate: 5.0, type: TaxType.REDUCED, isActive: true },
      { name: 'Exento de IVA 0%', code: 'VAT_0', rate: 0.0, type: TaxType.EXEMPT, isActive: true },
    ];

    let inserted = 0;
    for (const item of defaultCategories) {
      const exists = await this.taxCategoryRepository.findOne({ where: { code: item.code } });
      if (!exists) {
        await this.taxCategoryRepository.save(this.taxCategoryRepository.create(item));
        inserted++;
      }
    }

    return inserted;
  }

  /**
   * 2. Semilla de Categorías desde categories.json
   */
  private async seedCategories(): Promise<number> {
    const data = this.loadJsonData<CategorySeedData>('categories.json');
    let inserted = 0;

    for (const item of data) {
      const exists = await this.categoryRepository.findOne({ where: { slug: item.slug } });
      if (!exists) {
        await this.categoryRepository.save(this.categoryRepository.create(item));
        inserted++;
      }
    }

    return inserted;
  }

  /**
   * 3. Semilla de Marcas desde brands.json
   */
  private async seedBrands(): Promise<number> {
    const data = this.loadJsonData<BrandSeedData>('brands.json');
    let inserted = 0;

    for (const item of data) {
      const exists = await this.brandRepository.findOne({ where: { slug: item.slug } });
      if (!exists) {
        await this.brandRepository.save(this.brandRepository.create(item));
        inserted++;
      }
    }

    return inserted;
  }

  /**
   * 4. Semilla de Productos desde products.json, resolviendo relaciones por slug,
   * asignando categoría tributaria y creando el precio inicial en product_prices
   */
  private async seedProducts(): Promise<number> {
    const defaultTaxCategory = await this.taxCategoryRepository.findOne({ where: { code: 'VAT_19' } });
    const data = this.loadJsonData<ProductSeedData>('products.json');
    let count = 0;

    for (const item of data) {
      const exists = await this.productRepository.findOne({ where: { name: item.name } });

      const images = item.images && item.images.length > 0
        ? item.images
        : (item.imageUrl ? [item.imageUrl] : []);
      const mainImageUrl = item.imageUrl || (images.length > 0 ? images[0] : '');

      let productToPrice: Product;

      if (!exists) {
        let categoryId: string | undefined;
        let brandId: string | undefined;

        if (item.categorySlug) {
          const cat = await this.categoryRepository.findOne({ where: { slug: item.categorySlug } });
          if (cat) categoryId = cat.id;
        }

        if (item.brandSlug) {
          const brand = await this.brandRepository.findOne({ where: { slug: item.brandSlug } });
          if (brand) brandId = brand.id;
        }

        const newProduct = this.productRepository.create({
          name: item.name,
          slug: slugify(item.name),
          description: item.description,
          priceInCents: item.priceInCents,
          stock: item.stock,
          imageUrl: mainImageUrl,
          images,
          categoryId,
          brandId,
          taxCategoryId: defaultTaxCategory ? defaultTaxCategory.id : undefined,
        });

        productToPrice = await this.productRepository.save(newProduct);
        count++;
      } else {
        let updated = false;
        if (!exists.slug) {
          exists.slug = slugify(exists.name);
          updated = true;
        }
        if (!exists.taxCategoryId && defaultTaxCategory) {
          exists.taxCategoryId = defaultTaxCategory.id;
          updated = true;
        }
        if (item.stock !== undefined && exists.stock !== item.stock) {
          exists.stock = item.stock;
          updated = true;
        }
        // Si el producto ya existía pero no tenía galería de imágenes o tenía solo 1, actualizamos
        if (!exists.images || exists.images.length <= 1) {
          exists.images = images;
          if (!exists.imageUrl && mainImageUrl) {
            exists.imageUrl = mainImageUrl;
          }
          updated = true;
        }
        if (updated) {
          productToPrice = await this.productRepository.save(exists);
          count++;
        } else {
          productToPrice = exists;
        }
      }

      // Asegurar que tenga un registro activo en product_prices
      await this.ensureActiveProductPrice(productToPrice);
    }

    // Asegurar que cualquier producto en la base de datos tenga su slug, taxCategory y ProductPrice poblado
    const allProducts = await this.productRepository.find();
    for (const p of allProducts) {
      let needsSave = false;
      if (!p.slug) {
        p.slug = slugify(p.name);
        needsSave = true;
      }
      if (!p.taxCategoryId && defaultTaxCategory) {
        p.taxCategoryId = defaultTaxCategory.id;
        needsSave = true;
      }
      if (needsSave) {
        await this.productRepository.save(p);
      }
      await this.ensureActiveProductPrice(p);
    }

    return count;
  }

  private async ensureActiveProductPrice(product: Product): Promise<void> {
    const existing = await this.productPriceRepository.findOne({
      where: { productId: product.id, isActive: true },
    });

    if (!existing) {
      await this.productPriceRepository.save(
        this.productPriceRepository.create({
          productId: product.id,
          price: Number(product.priceInCents),
          currency: 'COP',
          taxIncluded: true,
          validFrom: new Date(),
          validTo: null,
          isActive: true,
        }),
      );
    }
  }

  /**
   * 4. Semilla de Plantillas de Notificación desde templates.json
   */
  private async seedTemplates(): Promise<number> {
    const data = this.loadJsonData<TemplateSeedData>('templates.json');
    let count = 0;

    for (const item of data) {
      let exists = await this.templateRepository.findOne({
        where: { name: item.name },
      });

      const creationDate = item.createdAt
        ? new Date(item.createdAt)
        : new Date('2026-09-24T22:21:00-05:00');

      if (!exists) {
        const newTemplate = this.templateRepository.create({
          name: item.name,
          isActive: true,
          createdAt: creationDate,
        });
        await this.templateRepository.save(newTemplate);
        count++;
      } else {
        exists.createdAt = creationDate;
        await this.templateRepository.save(exists);
        count++;
      }
    }

    return count;
  }
}
