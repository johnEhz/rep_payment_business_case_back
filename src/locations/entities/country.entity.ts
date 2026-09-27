import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('countries')
export class Country {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10, default: '+57' })
  phonePrefix: string;
}
