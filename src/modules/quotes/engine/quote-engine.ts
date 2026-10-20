import { add, formatMXN, multiply, splitByRate, subtract } from '../../../common/money/money';
import { planMonthlyCents, planTerms, SUBSCRIPTION_PLANS } from '../../pricing/subscription-plans';
import type { PackageCategory } from '../../catalog/catalog.constants';
import {
  type BlockingIssue,
  type CatalogSnapshot,
  type EngineComponent,
  type EngineItem,
  type EnginePackage,
  type IncludedItem,
  type QuoteCalculation,
  type QuoteLine,
  type QuoteSelection,
  QuoteSelectionError,
  type RecurringLine,
  type ReviewReason,
  type ReviewReasonCode,
  type SubscriptionPlanOption,
  type SubscriptionSummary,
} from './engine.types';

interface IncludedEntry {
  component: EngineComponent;
  quantity: number;
  removable: boolean;
  essential: boolean;
  /** Paquete dueño del componente: de su precio salen los créditos de retiro. */
  owner: EnginePackage;
  removed: boolean;
}

/**
 * Motor de cotización de ReaperSys. Determinista y sin efectos secundarios.
 *
 * Reglas comerciales:
 *  1. Cada componente adicional se cobra por las unidades que EXCEDEN lo incluido.
 *  2. Lo incluido nunca se cobra de nuevo; el ahorro de un combo es informativo (no se resta otra vez).
 *  3. Las dependencias se validan con compatibility_rules (block / review). Si el paquete define
 *     sus complementos compatibles (addOnIds), no se acepta ningún otro.
 *  4. Precios pendientes, "desde", evaluación o cambios en combos envían a revisión (cotización personalizada).
 *  5. Los recurrentes se calculan aparte y nunca se suman al total de implementación.
 *  6. En suscripción, el paquete no se cobra: se cobra la mensualidad (plazo mínimo) y, de contado,
 *     el pago inicial y los complementos. Los cambios al paquete obligan a ajustar la mensualidad.
 *  7. Todo paquete lleva dominio y hosting anuales, aparte del total (en suscripción, en el primer pago).
 *     Lo que el cliente ya tiene (clientProvided) no se cobra.
 */
export function calculateQuote(catalog: CatalogSnapshot, selection: QuoteSelection): QuoteCalculation {
  const reasons: ReviewReason[] = [];
  const issues: BlockingIssue[] = [];
  const lines: QuoteLine[] = [];
  const review = (code: ReviewReasonCode, message: string, componentSlug?: string) => {
    if (!reasons.some((r) => r.code === code && r.componentSlug === componentSlug)) reasons.push({ code, message, componentSlug });
  };

  // ------------------------------------------------------------ paquete y componentes incluidos
  const pkg = selection.packageSlug ? catalog.packagesBySlug.get(selection.packageSlug) : undefined;
  if (selection.packageSlug && (!pkg || !pkg.active)) throw new QuoteSelectionError('El paquete seleccionado no está disponible.');
  const paymentMode = selection.paymentMode ?? 'purchase';
  const subscribing = paymentMode === 'subscription';
  if (subscribing && !pkg) throw new QuoteSelectionError('La suscripción requiere elegir un paquete.');
  if (subscribing && !pkg!.rental) throw new QuoteSelectionError(`${pkg!.name} no se ofrece en suscripción.`);
  const rental = subscribing ? pkg!.rental! : null;
  const plan = selection.subscriptionPlan ?? 'monthly';
  if (!SUBSCRIPTION_PLANS.includes(plan)) throw new QuoteSelectionError('Plan de suscripción inválido.');
  const adjust = (what: string, slug?: string) =>
    review('subscription_adjustment', `${what} en la suscripción requiere ajustar la mensualidad.`, slug);

  const included = new Map<string, IncludedEntry>();
  const addItems = (items: EngineItem[], owner: EnginePackage) => {
    for (const item of items) {
      const component = catalog.components.get(item.componentId);
      if (!component) continue;
      const existing = included.get(component.id);
      if (existing) {
        existing.quantity += item.quantity;
        existing.removable &&= item.removable;
        existing.essential ||= item.essential;
      } else {
        included.set(component.id, { component, quantity: item.quantity, removable: item.removable, essential: item.essential, owner, removed: false });
      }
    }
  };

  let packageLine: QuoteLine | null = null;
  let comboRecalculate = false;
  const chosenVariants: Record<string, string> = {};
  const packageCategories = new Set<PackageCategory>();

  if (pkg) {
    packageCategories.add(pkg.category);
    const price = pkg.price;
    let amount: number | null = null;

    if (rental) {
      // El paquete se renta: solo se cobra de contado el pago inicial (o el equipo en POS).
      const known = rental.setupFeeCents !== null;
      if (!known && rental.hardwareUpfront) review('subscription_upfront_pending', `El equipo de ${pkg.name} (pago de contado) está pendiente de cotizar.`);
      if (rental.hardwareUpfront || (known && rental.setupFeeCents! > 0)) {
        lines.push({
          kind: 'subscription_setup',
          description: rental.hardwareUpfront ? `${pkg.name}: equipo e instalación (pago de contado)` : `${pkg.name}: instalación y configuración`,
          quantity: 1,
          unitCents: rental.setupFeeCents,
          amountCents: rental.setupFeeCents,
          priceMode: known ? 'fixed' : 'pending',
          taxable: true,
          priceRef: price ? { type: 'package', priceId: price.priceId, version: price.version } : undefined,
        });
      }
    } else if (pkg.pricingType === 'evaluation') {
      review('package_requires_evaluation', `${pkg.name} se cotiza tras una valoración.`);
    } else if (!price || price.mode === 'pending' || price.baseCents === null) {
      review('package_pending_price', `${pkg.name} aún no tiene precio aprobado.`);
    } else {
      amount = price.baseCents;
      if (price.mode === 'starting_at') review('package_starting_at', `El precio de ${pkg.name} es un mínimo sujeto a evaluación.`);
    }

    if (!rental) packageLine = {
      kind: 'package',
      description: pkg.name,
      quantity: 1,
      unitCents: amount,
      amountCents: amount,
      priceMode: price?.mode ?? 'pending',
      taxable: true,
      priceRef: price ? { type: 'package', priceId: price.priceId, version: price.version } : undefined,
    };
    if (packageLine) lines.push(packageLine);

    if (pkg.category !== 'combo') {
      assertKnownVariantKeys(selection.variants, pkg.variantGroups.map((g) => g.key));
      addItems(pkg.items, pkg);
      for (const group of pkg.variantGroups) {
        const optionKey = selection.variants[group.key] ?? group.defaultOption;
        const option = group.options.find((o) => o.key === optionKey);
        if (!option) throw new QuoteSelectionError(`Opción inválida para ${group.name}.`);
        chosenVariants[group.key] = option.key;
        addItems(option.items, pkg);

        if (option.key !== group.defaultOption && rental) {
          adjust(`Cambiar "${group.name}"`);
        } else if (option.key !== group.defaultOption) {
          const delta = price?.variantPrices.find((v) => v.groupKey === group.key && v.optionKey === option.key);
          const known = delta && delta.mode === 'fixed' && delta.deltaCents !== null;
          if (!known) review('variant_pending_price', `La diferencia de precio de "${option.name}" está pendiente de confirmar.`);
          lines.push({
            kind: 'variant',
            description: `${group.name}: ${option.name}`,
            quantity: 1,
            unitCents: known ? delta.deltaCents : null,
            amountCents: known ? delta.deltaCents : null,
            priceMode: known ? 'fixed' : 'pending',
            taxable: true,
            priceRef: price ? { type: 'package', priceId: price.priceId, version: price.version } : undefined,
          });
        }
      }
    } else {
      // Combo: incluye lo propio de la combinación y los paquetes contenidos con sus variantes fijadas.
      const allowedKeys: string[] = [];
      addItems(pkg.items, pkg);
      for (const ref of pkg.includesPackages) {
        const inner = catalog.packages.get(ref.packageId);
        if (!inner) continue;
        packageCategories.add(inner.category);
        addItems(inner.items, inner);
        for (const group of inner.variantGroups) {
          const key = `${inner.slug}/${group.key}`;
          allowedKeys.push(key);
          const locked = ref.variants[group.key] ?? group.defaultOption;
          const optionKey = selection.variants[key] ?? locked;
          const option = group.options.find((o) => o.key === optionKey);
          if (!option) throw new QuoteSelectionError(`Opción inválida para ${inner.name} — ${group.name}.`);
          chosenVariants[key] = option.key;
          addItems(option.items, inner);
          if (option.key !== locked && rental) {
            adjust(`Cambiar "${group.name}" de ${inner.name}`);
          } else if (option.key !== locked) {
            if (pkg.comboPolicy?.onVariantChange === 'recalculate') comboRecalculate = true;
            else review('combo_variant_changed', `Cambiar "${group.name}" en ${pkg.name} requiere revisar el precio del paquete combinado.`);
          }
        }
      }
      assertKnownVariantKeys(selection.variants, allowedKeys);
    }
  } else {
    review('custom_solution', 'Las soluciones armadas desde cero se cotizan tras una valoración personalizada.');
  }

  // ------------------------------------------------------------ componentes retirados
  for (const slug of unique(selection.removedComponents, 'componente retirado')) {
    const component = catalog.componentsBySlug.get(slug);
    const entry = component ? included.get(component.id) : undefined;
    if (!component || !entry) throw new QuoteSelectionError(`"${slug}" no forma parte del paquete seleccionado.`);
    if (!entry.removable) throw new QuoteSelectionError(`${component.name} no se puede retirar de este paquete.`);
    entry.removed = true;
    if (rental) {
      adjust(`Retirar ${component.name}`, slug);
      continue;
    }

    if (pkg?.category === 'combo' && entry.essential) {
      if (pkg.comboPolicy?.onEssentialRemoval === 'recalculate') comboRecalculate = true;
      else review('combo_essential_removed', `Retirar ${component.name} de ${pkg.name} requiere revisar el descuento del paquete.`, slug);
    }

    const credit = entry.owner.price?.removalCredits.find((c) => c.componentId === component.id);
    const known = credit && credit.mode === 'fixed' && credit.creditCents !== null;
    if (!known) review('removal_credit_pending', `El crédito por retirar ${component.name} está pendiente de aprobación.`, slug);
    lines.push({
      kind: 'removal_credit',
      description: `Retiro: ${component.name}`,
      componentSlug: slug,
      quantity: entry.quantity,
      unitCents: null,
      amountCents: known ? -credit.creditCents! : null,
      priceMode: 'credit',
      taxable: true,
      priceRef: entry.owner.price ? { type: 'package', priceId: entry.owner.price.priceId, version: entry.owner.price.version } : undefined,
    });
  }

  // ------------------------------------------------------------ combo: recálculo sin descuento
  let comboSavingsCents: number | null = null;
  if (pkg?.category === 'combo' && packageLine) {
    const separate = sumIncludedPackages(catalog, pkg, chosenVariants);
    if (comboRecalculate) {
      review('combo_discount_recalculated', `El descuento de ${pkg.name} no aplica con los cambios realizados; se cotizan sus paquetes por separado.`);
      packageLine.amountCents = separate;
      packageLine.unitCents = separate;
      if (separate === null) review('package_pending_price', 'Algún paquete contenido no tiene precio definitivo.');
    } else if (separate !== null && packageLine.amountCents !== null) {
      comboSavingsCents = subtract(separate, packageLine.amountCents);
    }
  }

  // ------------------------------------------------------------ complementos de pago único
  const selected = new Set<string>([...included.values()].filter((e) => !e.removed).map((e) => e.component.id));
  for (const id of rental?.includedComponentIds ?? []) selected.add(id);
  const chosenAddOns: EngineComponent[] = [];
  // Si el paquete define sus complementos compatibles, solo esos se aceptan.
  const offered = new Set(pkg?.addOnIds ?? []);

  for (const { slug, quantity } of uniqueBy(selection.components, (c) => c.slug, 'complemento')) {
    const component = catalog.componentsBySlug.get(slug);
    if (!component || !component.active) throw new QuoteSelectionError(`El componente "${slug}" no está disponible.`);
    if (component.billing !== 'one_time') throw new QuoteSelectionError(`${component.name} es un servicio recurrente; selecciónalo como tal.`);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new QuoteSelectionError(`Cantidad inválida para ${component.name}.`);

    const entry = included.get(component.id);
    if (entry?.removed) throw new QuoteSelectionError(`${component.name} fue retirado; no puede agregarse a la vez.`);
    if (!component.publicVisible && !entry) throw new QuoteSelectionError(`${component.name} no se ofrece como complemento.`);
    if (!entry && pkg && offered.size > 0 && !offered.has(component.id)) {
      throw new QuoteSelectionError(`${component.name} no se ofrece con ${pkg.name}.`);
    }

    const includedQty = entry?.quantity ?? 0;
    const chargeable = Math.max(0, quantity - includedQty);
    if (chargeable > component.maxQuantity) {
      throw new QuoteSelectionError(`${component.name}: máximo ${component.maxQuantity} unidades adicionales.`);
    }
    if (chargeable === 0) continue; // Ya incluido: no se cobra dos veces.

    selected.add(component.id);
    chosenAddOns.push(component);
    const price = component.price;
    const known = price && price.mode !== 'pending' && price.saleCents !== null;
    if (!known) review('component_pending_price', `${component.name} aún no tiene precio aprobado.`, slug);
    else if (price.mode === 'starting_at') review('component_starting_at', `${component.name} tiene un precio mínimo sujeto a evaluación.`, slug);
    if (component.requiresEvaluation) review('component_requires_evaluation', `${component.name} requiere una valoración técnica.`, slug);

    lines.push({
      kind: 'addon',
      description: component.name,
      componentSlug: slug,
      quantity: chargeable,
      includedQuantity: includedQty,
      unitCents: known ? price.saleCents : null,
      amountCents: known ? multiply(price.saleCents!, chargeable) : null,
      priceMode: price?.mode ?? 'pending',
      taxable: component.taxable,
      priceRef: price ? { type: 'component', priceId: price.priceId, version: price.version } : undefined,
    });
  }

  // ------------------------------------------------------------ dominio y hosting
  const clientProvided = unique(selection.clientProvided ?? [], 'servicio con el que ya cuentas');
  for (const slug of clientProvided) {
    if (!INFRASTRUCTURE_SLUGS.includes(slug)) throw new QuoteSelectionError(`"${slug}" no es dominio ni hosting.`);
  }
  const infrastructure = pkg
    ? INFRASTRUCTURE_SLUGS.flatMap((slug) => {
        const component = catalog.componentsBySlug.get(slug);
        return component?.active && !clientProvided.includes(slug) ? [component] : [];
      })
    : [];
  const providedByClient = clientProvided.flatMap((slug) => {
    const component = catalog.componentsBySlug.get(slug);
    return component ? [{ componentSlug: slug, name: component.name }] : [];
  });
  // Se cobran juntos, en un solo cargo anual (sin lo que el cliente ya tiene).
  let infrastructurePending = false;
  for (const component of infrastructure) {
    const price = component.price;
    if (!price || price.mode === 'pending' || price.saleCents === null) {
      infrastructurePending = true;
      review('component_pending_price', `${component.name} aún no tiene precio aprobado.`, component.slug);
    }
  }
  const infrastructureCents = infrastructurePending ? null : add(...infrastructure.map((c) => c.price!.saleCents!));

  // ------------------------------------------------------------ servicios recurrentes
  // En compra, el mantenimiento del paquete se cobra siempre. En renta ya va dentro de la mensualidad.
  const MAINTENANCE = new Set(['maintenance-web-basic', 'maintenance-web-business', 'maintenance-ecommerce', 'support-pos']);
  const annexed = !rental && pkg
    ? pkg.recommendedRecurringIds.flatMap((id) => {
        const component = catalog.components.get(id);
        return component && MAINTENANCE.has(component.slug) ? [component.slug] : [];
      })
    : [];
  const recurring: RecurringLine[] = [];
  const chosenRecurring: EngineComponent[] = [];
  for (const slug of [...new Set([...annexed, ...unique(selection.recurring, 'servicio recurrente')])]) {
    const component = catalog.componentsBySlug.get(slug);
    if (!component || !component.active || !component.publicVisible) throw new QuoteSelectionError(`El servicio "${slug}" no está disponible.`);
    if (component.billing === 'one_time') throw new QuoteSelectionError(`${component.name} no es un servicio recurrente.`);
    if (rental?.includedComponentIds.includes(component.id)) throw new QuoteSelectionError(`${component.name} ya está incluido en la suscripción.`);
    if (INFRASTRUCTURE_SLUGS.includes(slug)) throw new QuoteSelectionError(`${component.name} ya va con el paquete, junto con el dominio y hosting.`);
    selected.add(component.id);
    chosenRecurring.push(component);

    const price = component.price;
    const known = price && price.mode !== 'pending' && price.saleCents !== null;
    if (known && (price.mode === 'starting_at' || component.requiresEvaluation)) {
      review('recurring_starting_at', `${component.name}: la mensualidad es un mínimo sujeto a evaluación.`, slug);
    }
    recurring.push({
      componentSlug: slug,
      description: component.name,
      billing: component.billing,
      amountCents: known ? price.saleCents : null,
      priceMode: price?.mode ?? 'pending',
      priceRef: price ? { type: 'component', priceId: price.priceId, version: price.version } : undefined,
    });
  }
  // En compra, dominio y hosting son una sola línea anual. En suscripción van en el cargo anual (abajo).
  if (!rental && infrastructure.length > 0) {
    recurring.push({
      componentSlug: INFRASTRUCTURE_LINE_SLUG,
      description: infrastructureName(infrastructure),
      billing: 'annual',
      amountCents: infrastructureCents,
      priceMode: infrastructurePending ? 'pending' : 'fixed',
    });
  }

  // ------------------------------------------------------------ grupos excluyentes
  const groups = new Map<string, string>();
  for (const component of [...chosenAddOns, ...chosenRecurring]) {
    if (!component.exclusiveGroup) continue;
    const other = groups.get(component.exclusiveGroup);
    if (other) throw new QuoteSelectionError(`${component.name} y ${other} son excluyentes: elige solo uno.`);
    groups.set(component.exclusiveGroup, component.name);
  }

  // ------------------------------------------------------------ compatibilidad
  for (const component of [...chosenAddOns, ...chosenRecurring]) {
    for (const rule of catalog.rulesBySubject.get(component.id) ?? []) {
      const violated =
        rule.type === 'requires_package_category'
          ? !rule.packageCategories.some((c) => packageCategories.has(c))
          : rule.type === 'requires_component'
            ? !rule.targetIds.some((id) => selected.has(id))
            : rule.targetIds.some((id) => selected.has(id));
      if (!violated) continue;
      if (rule.action === 'block') {
        issues.push({ code: 'compatibility_blocked', message: rule.message, componentSlug: component.slug, ruleKey: rule.key });
      } else {
        review('compatibility_review', rule.message, component.slug);
      }
    }
  }

  // ------------------------------------------------------------ totales
  const { settings } = catalog;
  const known = lines.filter((l) => l.amountCents !== null);
  const subtotalCents = add(...known.map((l) => l.amountCents!));
  const taxableCents = 0;
  const discountCents = 0; // Descuentos manuales autorizados: Fase 5 (administración).
  const taxCents = 0;
  const totalCents = subtotalCents;
  if (totalCents < 0) review('negative_total', 'Los créditos superan el importe del paquete; requiere revisión.');

  const { first: depositCents, second: balanceCents } = splitByRate(Math.max(totalCents, 0), settings.depositRateBp);
  const recurringMonthlyCents = add(...recurring.filter((r) => r.billing === 'monthly' && r.amountCents !== null).map((r) => r.amountCents!));
  const recurringAnnualCents = add(...recurring.filter((r) => r.billing === 'annual' && r.amountCents !== null).map((r) => r.amountCents!));

  let subscription: SubscriptionSummary | null = null;
  if (rental && pkg) {
    const base = rental.mode === 'pending' ? null : rental.monthlyCents;
    if (base === null) review('subscription_pending_price', `La mensualidad de ${pkg.name} aún no está aprobada.`);
    else if (rental.mode === 'starting_at') review('subscription_starting_at', `La mensualidad de ${pkg.name} es un mínimo sujeto a confirmar costos de operación.`);
    const plans: SubscriptionPlanOption[] = SUBSCRIPTION_PLANS.map((option) => {
      const terms = planTerms(option, settings.rentalPlans);
      const monthly = base === null ? null : planMonthlyCents(base, terms);
      // La comparación usa el plazo oficial del plan (1 mes si no hay plazo forzoso).
      const compareMonths = terms.termMonths === 0 ? 1 : terms.termMonths;
      return {
        plan: option,
        label: terms.label,
        billingMonths: terms.billingMonths,
        termMonths: terms.termMonths,
        adjustmentBp: terms.adjustmentBp,
        monthlyCents: monthly,
        monthlyTotalCents: monthly,
        paymentCents: monthly === null ? null : multiply(monthly, terms.billingMonths),
        budgetCents: monthly === null || terms.termMonths === 0 ? null : multiply(monthly, terms.termMonths),
        savingsVsMonthlyCents:
          monthly === null || base === null ? null : subtract(multiply(base, compareMonths), multiply(monthly, compareMonths)),
      };
    });
    const chosen = plans.find((p) => p.plan === plan)!;
    const upfrontPending = lines.some((line) => line.amountCents === null);
    const subsequentPaymentCents = chosen.paymentCents;
    // Dominio y hosting del año: aparte de la mensualidad, en el primer pago.
    const annualCharge = infrastructureCents ? { name: infrastructureName(infrastructure), cents: infrastructureCents } : null;
    const firstPaymentCents =
      subsequentPaymentCents === null || upfrontPending || infrastructurePending ? null : add(totalCents, subsequentPaymentCents, annualCharge?.cents ?? 0);
    const supportIncludedCents = rental.supportIncludedCents ?? null;
    const specifications = rental.softwareOnly ? [...pkg.features] : [];
    subscription = {
      plan,
      planLabel: chosen.label,
      baseMonthlyCents: base,
      monthlyCents: chosen.monthlyCents,
      priceMode: rental.mode,
      monthlyTaxCents: 0,
      monthlyTotalCents: chosen.monthlyCents,
      billingMonths: chosen.billingMonths,
      paymentCents: chosen.paymentCents,
      termMonths: chosen.termMonths,
      commitmentCents: chosen.budgetCents,
      hostingCharge: null,
      annualCharge,
      supportIncludedCents,
      softwareOnly: rental.softwareOnly ?? false,
      firstPaymentCents,
      subsequentPaymentCents,
      plans,
      hardwareUpfront: rental.hardwareUpfront,
      includes: specifications.length > 0 || rental.softwareOnly
        ? [
            ...specifications,
            ...(rental.softwareOnly ? ['Solo el software; no incluye equipo'] : []),
            ...(supportIncludedCents != null
              ? [`Soporte al usuario durante todo el mes (${formatMXN(supportIncludedCents)}, ya incluido en la mensualidad)`]
              : []),
            ...(annualCharge ? [`${annualCharge.name}: ${formatMXN(annualCharge.cents)} al año, aparte de la mensualidad`] : []),
          ]
        : [
            'Uso del sistema mientras la suscripción esté activa',
            ...(rental.storageGb > 0 ? [`Almacenamiento de ${rental.storageGb} GB`] : []),
            ...(rental.includesDomain ? ['Dominio .com.mx (renovación anual)'] : []),
            ...rental.serviceNames,
          ],
      priceRef: pkg.price ? { type: 'package', priceId: pkg.price.priceId, version: pkg.price.version } : undefined,
    };
  }

  if (settings.validityDays === null) review('validity_not_configured', 'La vigencia de las cotizaciones aún no está configurada.');

  const includedItems: IncludedItem[] = [...included.values()].map((entry) => ({
    componentSlug: entry.component.slug,
    name: entry.component.name,
    quantity: entry.quantity,
    fromPackage: entry.owner.slug,
    removable: entry.removable,
    removed: entry.removed,
  }));

  if (!pkg && chosenAddOns.length === 0 && chosenRecurring.length === 0) {
    throw new QuoteSelectionError('Selecciona un paquete o al menos un componente.');
  }

  return {
    currency: 'MXN',
    status: issues.length > 0 ? 'blocked' : reasons.length > 0 ? 'needs_review' : 'priced',
    paymentMode,
    subscription,
    package: pkg ? { slug: pkg.slug, name: pkg.name, category: pkg.category, variants: chosenVariants } : null,
    lines,
    includedItems,
    recurring,
    providedByClient,
    totals: {
      subtotalCents,
      discountCents,
      taxableCents,
      taxCents,
      totalCents,
      depositCents,
      balanceCents,
      recurringMonthlyCents,
      recurringAnnualCents,
      hasPendingAmounts: lines.some((l) => l.amountCents === null),
    },
    tax: { rateBp: settings.taxRateBp, treatment: settings.taxTreatment, confirmed: settings.taxConfirmed },
    depositRateBp: settings.depositRateBp,
    comboSavingsCents,
    reviewReasons: reasons,
    blockingIssues: issues,
  };
}

/** Dominio y hosting: se cobran con todo paquete, una vez al año. */
export const INFRASTRUCTURE_SLUGS = ['hosting-annual', 'domain-annual'];
/** Línea recurrente única de dominio y hosting en la cotización. */
export const INFRASTRUCTURE_LINE_SLUG = 'domain-hosting';

/** «Dominio y hosting», o solo el que se cobra. */
function infrastructureName(components: EngineComponent[]): string {
  return components.length === 1 ? components[0]!.name : 'Dominio y hosting';
}

/** Suma de los paquetes contenidos en un combo con las variantes elegidas; null si alguno está pendiente. */
function sumIncludedPackages(catalog: CatalogSnapshot, combo: EnginePackage, chosen: Record<string, string>): number | null {
  const amounts: number[] = [];
  for (const ref of combo.includesPackages) {
    const inner = catalog.packages.get(ref.packageId);
    const price = inner?.price;
    if (!inner || !price || price.mode === 'pending' || price.baseCents === null) return null;
    amounts.push(price.baseCents);
    for (const group of inner.variantGroups) {
      const option = chosen[`${inner.slug}/${group.key}`] ?? ref.variants[group.key] ?? group.defaultOption;
      if (option === group.defaultOption) continue;
      const delta = price.variantPrices.find((v) => v.groupKey === group.key && v.optionKey === option);
      if (!delta || delta.mode === 'pending' || delta.deltaCents === null) return null;
      amounts.push(delta.deltaCents);
    }
  }
  return add(...amounts);
}

function assertKnownVariantKeys(variants: Record<string, string>, allowed: string[]): void {
  for (const key of Object.keys(variants)) {
    if (!allowed.includes(key)) throw new QuoteSelectionError(`Grupo de variantes desconocido: "${key}".`);
  }
}

function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new QuoteSelectionError(`Hay un ${label} repetido.`);
  return values;
}

function uniqueBy<T>(values: T[], key: (value: T) => string, label: string): T[] {
  unique(values.map(key), label);
  return values;
}
