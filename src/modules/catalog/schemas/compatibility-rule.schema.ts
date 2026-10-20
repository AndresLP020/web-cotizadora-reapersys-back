import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import {
  COMPATIBILITY_RULE_TYPES,
  type CompatibilityRuleType,
  PACKAGE_CATEGORIES,
  type PackageCategory,
  RULE_ACTIONS,
  type RuleAction,
} from '../catalog.constants';

/** Dependencias y exclusiones evaluadas por el motor de cotización (regla comercial 3). */
@Schema({ collection: 'compatibility_rules', timestamps: true })
export class CompatibilityRule {
  @Prop({ required: true, unique: true, match: /^[a-z0-9-]+$/ })
  key!: string;

  @Prop({ required: true, enum: COMPATIBILITY_RULE_TYPES })
  type!: CompatibilityRuleType;

  /** Componente al que aplica la regla. */
  @Prop({ type: Types.ObjectId, ref: 'Component', required: true, index: true })
  subject!: Types.ObjectId;

  /** Para requires_package_category: basta con una de estas categorías. */
  @Prop({ type: [String], enum: PACKAGE_CATEGORIES, default: [] })
  packageCategories!: PackageCategory[];

  /** Para requires_component / excludes_component. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Component' }], default: [] })
  targets!: Types.ObjectId[];

  @Prop({ required: true, enum: RULE_ACTIONS, default: 'block' })
  action!: RuleAction;

  /** Mensaje mostrado al cliente cuando la regla se incumple. */
  @Prop({ required: true, maxlength: 300 })
  message!: string;

  @Prop({ default: true })
  active!: boolean;
}

export type CompatibilityRuleDocument = HydratedDocument<CompatibilityRule>;
export const CompatibilityRuleSchema = SchemaFactory.createForClass(CompatibilityRule);
