/**
 * Catálogo inicial de ReaperSys, tomado del brief comercial (importes iniciales sugeridos en MXN).
 * Paquetes, precios base y módulos de tienda/POS: REAPERSYS_CATALOGO_COTIZADOR.md (referencia ARISE).
 *
 * Reglas:
 * - Ningún precio se inventa: lo que el brief no define queda como `pending`.
 * - Los precios "desde" se cargan como `starting_at` + requiresEvaluation.
 * - Importes en PESOS ENTEROS aquí; el seed los convierte a centavos.
 */
import type {
  BillingType,
  ComboRemovalPolicy,
  ComponentCondition,
  ComponentKind,
  PackageCategory,
  PackagePricingType,
  RuleAction,
  SolutionKind,
} from '../../modules/catalog/catalog.constants';

export interface SeedPrice {
  mode: 'fixed' | 'starting_at' | 'pending';
  pesos?: number;
}

export interface SeedCategory {
  slug: string;
  name: string;
  description?: string;
  sortOrder: number;
}

export interface SeedComponent {
  sku: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  kind: ComponentKind;
  billing?: BillingType;
  unit?: string;
  condition?: ComponentCondition;
  publicVisible?: boolean;
  requiresEvaluation?: boolean;
  maxQuantity?: number;
  exclusiveGroup?: string;
  price: SeedPrice;
}

export interface SeedPackageItem {
  component: string;
  quantity?: number;
  removable?: boolean;
  essential?: boolean;
}

export interface SeedPackage {
  slug: string;
  name: string;
  category: PackageCategory;
  summary: string;
  features: string[];
  notes?: string[];
  pricingType?: PackagePricingType;
  items?: SeedPackageItem[];
  variantGroups?: {
    key: string;
    name: string;
    defaultOption: string;
    options: { key: string; name: string; description?: string; items: SeedPackageItem[] }[];
  }[];
  includesPackages?: { package: string; variants?: Record<string, string> }[];
  comboPolicy?: { onEssentialRemoval: ComboRemovalPolicy; onVariantChange: ComboRemovalPolicy };
  recommendedRecurring?: string[];
  /** Complementos opcionales compatibles con el paquete (solo estos se ofrecen en «Puedes agregar»). */
  addOns?: string[];
  featured?: boolean;
  /** Suscripción mensual (se asigna abajo, por tipo de paquete). */
  rental?: SeedRentalProfile;
  price: {
    mode: 'fixed' | 'starting_at' | 'pending';
    basePesos?: number;
    /** Diferencias por variante; null = pendiente. */
    variantDeltas?: { group: string; option: string; pesos: number | null }[];
  };
}

export interface SeedRule {
  key: string;
  type: 'requires_package_category' | 'requires_component' | 'excludes_component';
  subject: string;
  packageCategories?: PackageCategory[];
  targets?: string[];
  action: RuleAction;
  message: string;
}

export interface SeedIndustry {
  slug: string;
  name: string;
  description: string;
  exampleSolutions: string[];
  suggestedSolutions: SolutionKind[];
}

// ---------------------------------------------------------------------------- categorías

export const seedCategories: SeedCategory[] = [
  { slug: 'desarrollo-web', name: 'Desarrollo web', sortOrder: 10 },
  { slug: 'redes-contacto', name: 'Redes y contacto', sortOrder: 20 },
  { slug: 'ecommerce', name: 'E-commerce', sortOrder: 30 },
  { slug: 'modulos-tienda', name: 'Módulos de tienda virtual', description: 'Funcionalidades de la tienda virtual (referencia ARISE, Parte 1).', sortOrder: 32 },
  { slug: 'modulos-pos', name: 'Módulos de punto de venta', description: 'Funcionalidades del punto de venta (referencia ARISE, Parte 2).', sortOrder: 34 },
  { slug: 'hardware-pos', name: 'Hardware para punto de venta', sortOrder: 40 },
  { slug: 'software-licencias', name: 'Software y licencias', sortOrder: 50 },
  { slug: 'servicios-implementacion', name: 'Servicios de implementación', sortOrder: 60 },
  { slug: 'servicios-recurrentes', name: 'Servicios recurrentes', sortOrder: 70 },
];

// ---------------------------------------------------------------------------- componentes

const PENDING: SeedPrice = { mode: 'pending' };
const fixed = (pesos: number): SeedPrice => ({ mode: 'fixed', pesos });
const from = (pesos: number): SeedPrice => ({ mode: 'starting_at', pesos });

export const seedComponents: SeedComponent[] = [
  // Desarrollo web — complementos públicos
  { sku: 'WEB-SECTION', slug: 'web-section', name: 'Sección adicional', category: 'desarrollo-web', kind: 'feature', unit: 'sección', publicVisible: true, maxQuantity: 30, price: fixed(450) },
  { sku: 'WEB-PAGE', slug: 'web-internal-page', name: 'Página interna adicional', category: 'desarrollo-web', kind: 'feature', unit: 'página', publicVisible: true, maxQuantity: 30, price: fixed(950) },
  { sku: 'WEB-GALLERY', slug: 'web-gallery', name: 'Galería', category: 'desarrollo-web', kind: 'feature', publicVisible: true, price: fixed(700) },
  { sku: 'WEB-SEO', slug: 'seo-initial', name: 'SEO inicial', category: 'desarrollo-web', kind: 'service', publicVisible: true, price: fixed(1500) },
  { sku: 'WEB-BLOG', slug: 'managed-blog', name: 'Blog administrable', category: 'desarrollo-web', kind: 'feature', publicVisible: true, price: fixed(2500) },
  { sku: 'WEB-ADV-DESIGN', slug: 'advanced-visual-design', name: 'Diseño visual avanzado', category: 'desarrollo-web', kind: 'service', publicVisible: true, requiresEvaluation: true, price: from(3000) },
  { sku: 'WEB-ADV-ANIM', slug: 'advanced-animations', name: 'Animaciones avanzadas', category: 'desarrollo-web', kind: 'feature', publicVisible: true, requiresEvaluation: true, price: from(1500) },

  // Desarrollo web — bases incluidas en paquetes (no se venden por separado)
  { sku: 'WEB-LANDING', slug: 'landing-page-build', name: 'Desarrollo de landing page', category: 'desarrollo-web', kind: 'service', unit: 'proyecto', price: PENDING },
  { sku: 'WEB-CORPORATE', slug: 'corporate-site-build', name: 'Desarrollo de sitio web corporativo', category: 'desarrollo-web', kind: 'service', unit: 'proyecto', price: PENDING },

  // Redes y contacto
  { sku: 'SOC-WA-BTN', slug: 'whatsapp-button', name: 'Botón de WhatsApp', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(350) },
  { sku: 'SOC-FB-BTN', slug: 'facebook-button', name: 'Botón de Facebook', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(200) },
  { sku: 'SOC-IG-BTN', slug: 'instagram-button', name: 'Botón de Instagram', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(200) },
  { sku: 'SOC-TT-BTN', slug: 'tiktok-button', name: 'Botón de TikTok', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(200) },
  { sku: 'SOC-MAIL-BTN', slug: 'email-button', name: 'Botón de correo', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(200) },
  { sku: 'SOC-CONTACT-FORM', slug: 'contact-form', name: 'Formulario de contacto', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(650) },
  { sku: 'SOC-QUOTE-FORM', slug: 'quote-form', name: 'Formulario de cotización', category: 'redes-contacto', kind: 'feature', publicVisible: true, requiresEvaluation: true, price: from(1500) },
  { sku: 'SOC-WA-WIDGET', slug: 'whatsapp-widget', name: 'Widget de WhatsApp', category: 'redes-contacto', kind: 'feature', publicVisible: true, price: fixed(900) },
  { sku: 'SOC-WA-API', slug: 'whatsapp-business-api', name: 'WhatsApp Business API', description: 'Integración de mensajería automática para el negocio del cliente.', category: 'redes-contacto', kind: 'service', publicVisible: true, requiresEvaluation: true, price: from(3500) },
  { sku: 'SOC-CRM', slug: 'crm-integration', name: 'Integración con CRM', category: 'redes-contacto', kind: 'service', publicVisible: true, requiresEvaluation: true, price: from(3000) },
  { sku: 'SOC-CHATBOT', slug: 'chatbot', name: 'Chatbot', category: 'redes-contacto', kind: 'service', publicVisible: true, requiresEvaluation: true, price: from(4500) },

  // E-commerce — complementos públicos
  { sku: 'ECO-PRODUCT', slug: 'ecommerce-product', name: 'Producto adicional', description: 'El catálogo de la tienda no tiene límite de productos.', category: 'ecommerce', kind: 'feature', unit: 'producto', publicVisible: false, maxQuantity: 1000, price: fixed(60) },
  { sku: 'ECO-GATEWAY', slug: 'payment-gateway', name: 'Pasarela de pago adicional', category: 'ecommerce', kind: 'service', unit: 'pasarela', publicVisible: true, maxQuantity: 5, price: fixed(1500) },
  { sku: 'ECO-SHIPPING-ADV', slug: 'advanced-shipping', name: 'Configuración avanzada de envíos', category: 'ecommerce', kind: 'service', publicVisible: true, requiresEvaluation: true, price: from(1500) },
  { sku: 'ECO-SUBSCRIPTIONS', slug: 'subscriptions', name: 'Suscripciones', category: 'ecommerce', kind: 'feature', publicVisible: true, requiresEvaluation: true, price: from(3500) },
  { sku: 'ECO-WISHLIST', slug: 'wishlist', name: 'Lista de deseos', category: 'ecommerce', kind: 'feature', publicVisible: true, price: fixed(1200) },
  { sku: 'ECO-CART-RECOVERY', slug: 'cart-recovery', name: 'Recuperación de carrito', category: 'ecommerce', kind: 'feature', publicVisible: true, requiresEvaluation: true, price: from(2000) },
  { sku: 'ECO-REVIEWS', slug: 'reviews', name: 'Sistema de reseñas', category: 'ecommerce', kind: 'feature', publicVisible: true, price: fixed(950) },
  { sku: 'ECO-REPORTS', slug: 'custom-reports', name: 'Reportes personalizados', category: 'ecommerce', kind: 'feature', publicVisible: true, requiresEvaluation: true, price: from(2500) },
  { sku: 'ECO-POS-SYNC', slug: 'pos-ecommerce-sync', name: 'Sincronización POS / e-commerce', description: 'Requiere revisión técnica previa.', category: 'ecommerce', kind: 'service', publicVisible: true, requiresEvaluation: true, price: from(6000) },

  // E-commerce — funcionalidades incluidas en paquetes
  { sku: 'ECO-STORE', slug: 'online-store-build', name: 'Desarrollo de tienda virtual', category: 'ecommerce', kind: 'service', unit: 'proyecto', price: PENDING },
  { sku: 'ECO-STORE-ADV', slug: 'online-store-advanced-build', name: 'Desarrollo de tienda virtual avanzada', category: 'ecommerce', kind: 'service', unit: 'proyecto', price: PENDING },
  { sku: 'ECO-CART', slug: 'shopping-cart', name: 'Carrito de compras', category: 'ecommerce', kind: 'feature', price: PENDING },
  { sku: 'ECO-ORDERS', slug: 'order-management', name: 'Gestión de pedidos', category: 'ecommerce', kind: 'feature', price: PENDING },
  { sku: 'ECO-ACCOUNTS', slug: 'customer-accounts', name: 'Cuentas de clientes', category: 'ecommerce', kind: 'feature', price: PENDING },
  { sku: 'ECO-COUPONS', slug: 'coupons', name: 'Cupones', category: 'ecommerce', kind: 'feature', price: PENDING },
  { sku: 'ECO-FILTERS', slug: 'catalog-filters', name: 'Filtros de catálogo', category: 'ecommerce', kind: 'feature', price: PENDING },
  { sku: 'ECO-VARIANTS', slug: 'product-variants', name: 'Variantes de producto', category: 'ecommerce', kind: 'feature', price: PENDING },
  { sku: 'ECO-SHIPPING', slug: 'shipping-options', name: 'Opciones de envío', category: 'ecommerce', kind: 'feature', price: PENDING },

  // Tienda virtual (ARISE Parte 1) — incluidas en el paquete base, no se venden por separado
  { sku: 'TV-PUBLIC-SITE', slug: 'store-public-site', name: 'Página pública de la tienda', description: 'Navbar responsive, hero, footer y secciones principales.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-CATALOG', slug: 'store-catalog', name: 'Catálogo de productos', description: 'Productos activos con imagen, nombre, descripción, precio y categoría.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-DISCOVERY', slug: 'store-search-filters', name: 'Búsqueda, filtro y paginación', description: 'Búsqueda por nombre, categoría, descripción o código; filtro por categoría y paginación.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-FEATURED', slug: 'store-featured-products', name: 'Productos destacados', description: 'Hasta seis productos destacados, configurados en el sistema.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-CART', slug: 'store-cart', name: 'Carrito de compras', description: 'Agregar, modificar cantidades, quitar, vaciar, subtotales y persistencia local.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-CHECKOUT', slug: 'store-checkout', name: 'Checkout', description: 'Nombre, teléfono, correo opcional, notas, validación y resumen.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-DELIVERY', slug: 'store-delivery', name: 'Entrega', description: 'Recoger en tienda o envío a domicilio con tarifa configurable.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-BASIC-PAY', slug: 'store-basic-payments', name: 'Pagos básicos', description: 'Transferencia bancaria o efectivo, con las instrucciones correspondientes.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-ORDERS', slug: 'store-orders', name: 'Pedidos', description: 'Creación, estados, confirmación y página de consulta con token seguro.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-PROTECT', slug: 'store-integrity', name: 'Protecciones esenciales', description: 'Precios y stock validados en el backend; no se duplican pedidos ni descuentos de inventario.', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-CONTACT', slug: 'store-contact-info', name: 'Información de contacto', description: 'Teléfono, correo, redes, dirección y horarios, si están configurados (solo visualización).', category: 'modulos-tienda', kind: 'feature', price: PENDING },
  { sku: 'TV-UX', slug: 'store-experience', name: 'Experiencia', description: 'Diseño adaptable, animaciones básicas y accesibilidad documentada.', category: 'modulos-tienda', kind: 'feature', price: PENDING },

  // Tienda virtual — adicionales (precio por aprobar desde Administración)
  { sku: 'TV-OFFERS', slug: 'offers-manager', name: 'Gestor de ofertas', description: 'Alta, edición, activación, fechas, imagen, productos asociados y precio normal/oferta. Las ofertas son informativas: no cambian el precio del checkout.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'TV-STRIPE', slug: 'stripe-payments', name: 'Pagos con Stripe', description: 'Integración, confirmación y webhook verificado. Requiere cuenta habilitada, claves y entorno público. Las comisiones de Stripe no forman parte del precio.', category: 'modulos-tienda', kind: 'service', publicVisible: true, price: PENDING },
  { sku: 'TV-MERCADOPAGO', slug: 'mercadopago-payments', name: 'Pagos con Mercado Pago', description: 'Integración, confirmación y webhook. Requiere cuenta, claves y URL pública del backend. Las comisiones de Mercado Pago no forman parte del precio.', category: 'modulos-tienda', kind: 'service', publicVisible: true, price: PENDING },
  { sku: 'TV-TRANSFER-PROOF', slug: 'transfer-proof', name: 'Comprobante de transferencia', description: 'Subida y cambio de comprobante, y verificación administrativa para confirmar o rechazar.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'TV-ORDER-EDIT', slug: 'order-editing', name: 'Edición de pedidos', description: 'Editar el pedido mientras no esté pagado ni en un estado no editable.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'TV-PAY-SWITCH', slug: 'payment-method-change', name: 'Cambio de método de pago', description: 'Cambiar el método de pago en pedidos elegibles.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'TV-ORDER-EMAILS', slug: 'order-emails', name: 'Correos automáticos de pedidos', description: 'Pedido, comprobante, confirmación o rechazo. Requiere un proveedor SMTP; el cliente solo los recibe si dio su correo.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'TV-BULK', slug: 'bulk-sales', name: 'Venta a granel', description: 'Productos por kg y cantidades decimales, con cálculo correcto de existencias.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'TV-WA-TRANSFER', slug: 'whatsapp-transfer-notice', name: 'Aviso de transferencia por WhatsApp', description: 'Botón con mensaje prellenado y número configurado. No envía mensajes automáticos por API.', category: 'modulos-tienda', kind: 'feature', publicVisible: true, price: PENDING },

  // Punto de venta (ARISE Parte 2) — incluidas en el paquete base
  { sku: 'POS-AUTH', slug: 'pos-auth', name: 'Inicio de sesión y seguridad', description: 'Inicio de sesión, sesiones y restricciones de operaciones.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-DASHBOARD', slug: 'pos-dashboard', name: 'Dashboard', description: 'Productos activos, transacciones, stock bajo, ventas recientes y productos más vendidos.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-PRODUCTS', slug: 'pos-products', name: 'Productos', description: 'Alta, consulta y edición: códigos, categorías, costos, precios, activo/inactivo, imagen y stock.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-INVENTORY', slug: 'pos-inventory', name: 'Inventario', description: 'Stock mínimo, advertencias y descuento al registrar una venta.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-REGISTER', slug: 'pos-register', name: 'Venta en caja', description: 'Búsqueda o escaneo por código, carrito, cantidades, precio de línea, cobro, cambio y saldo.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-TICKETS', slug: 'pos-tickets', name: 'Tickets', description: 'Impresión de tickets de venta.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-CUSTOMERS', slug: 'pos-customers', name: 'Clientes', description: 'Registro, búsqueda y edición de clientes.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-HISTORY', slug: 'pos-sales-history', name: 'Historial básico', description: 'Consulta de ventas registradas.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  { sku: 'POS-SETTINGS', slug: 'pos-settings', name: 'Configuración esencial', description: 'Parámetros y controles indispensables para la operación base.', category: 'modulos-pos', kind: 'feature', price: PENDING },
  // Solo con tienda virtual: en la Solución Combinada va incluido; nunca se ofrece aislado a un POS.
  { sku: 'POS-ONLINE-ORDERS', slug: 'pos-online-orders', name: 'Pedidos en línea desde el POS', description: 'Administra desde el POS los pedidos de la tienda virtual, sus pagos, comprobantes y estados.', category: 'modulos-pos', kind: 'feature', price: PENDING },

  // Punto de venta — adicionales (precio por aprobar desde Administración)
  { sku: 'POS-CSV', slug: 'pos-csv-import-export', name: 'Importar y exportar productos (CSV)', description: 'Hasta 2,000 productos por archivo en la referencia.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-SUPPLIERS', slug: 'pos-suppliers', name: 'Proveedores', description: 'Registro y gestión de proveedores asociados a los productos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-SUPPLIER-ACCT', slug: 'pos-supplier-accounts', name: 'Cuentas de proveedores', description: 'Deudas, pagos y movimientos de proveedores. Requiere el módulo Proveedores.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-CREDIT', slug: 'pos-credit-sales', name: 'Ventas a crédito', description: 'Ventas con crédito, deudores y abonos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-ADV-HISTORY', slug: 'pos-advanced-history', name: 'Historial avanzado', description: 'Filtros avanzados, edición y reimpresión de tickets corregidos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-RETURNS', slug: 'pos-returns', name: 'Devoluciones', description: 'Devoluciones revendibles o pérdida, con ajuste de inventario.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-EXPENSES', slug: 'pos-expenses', name: 'Gastos administrativos', description: 'Registro de gastos, categorías y resumen por periodo. Acceso de administrador.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-PAYROLL', slug: 'pos-payroll', name: 'Sueldos', description: 'Trabajadores, sueldos semanales, cálculo y procesamiento de nómina. Para reflejar la nómina en resultados se necesita Gastos administrativos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-ADVANCES', slug: 'pos-payroll-advances', name: 'Adelantos de sueldo', description: 'Registro de adelantos y descuentos semanales. Requiere el módulo Sueldos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-REPORTS', slug: 'pos-reports', name: 'Reportes', description: 'Ingresos, costos, ganancias, productos vendidos y exportación CSV. La ganancia neta después de gastos necesita Gastos administrativos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-SAVINGS', slug: 'pos-savings-goals', name: 'Metas de ahorro', description: 'Metas, ahorro diario y calendario de registro. Acceso de administrador.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },
  { sku: 'POS-USERS', slug: 'pos-users-permissions', name: 'Usuarios y permisos', description: 'Alta de usuarios con permisos para ventas y gestión de productos.', category: 'modulos-pos', kind: 'feature', publicVisible: true, price: PENDING },

  // Hardware POS (precios individuales pendientes; no son necesarios para la arquitectura)
  { sku: 'HW-PC-REF-I5', slug: 'pc-refurbished-i5', name: 'Computadora reacondicionada Intel Core i5', category: 'hardware-pos', kind: 'hardware', unit: 'equipo', condition: 'refurbished', price: PENDING },
  { sku: 'HW-PC-NEW-I5', slug: 'pc-new-i5', name: 'Computadora nueva Intel Core i5', category: 'hardware-pos', kind: 'hardware', unit: 'equipo', condition: 'new', price: PENDING },
  { sku: 'HW-RAM-8', slug: 'ram-8gb', name: 'Memoria RAM 8 GB', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-RAM-16', slug: 'ram-16gb', name: 'Memoria RAM 16 GB', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-HDD-250', slug: 'hdd-250gb', name: 'Disco duro HDD 250 GB', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-HDD-500', slug: 'hdd-500gb', name: 'Disco duro HDD 500 GB', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-SSD-256', slug: 'ssd-256gb', name: 'Unidad SSD 256 GB', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-SSD-512', slug: 'ssd-512gb', name: 'Unidad SSD 512 GB', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-MON-19-LCD', slug: 'monitor-lcd-19', name: 'Monitor LCD de 19 pulgadas', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-MON-19', slug: 'monitor-19', name: 'Monitor de 19 pulgadas', category: 'hardware-pos', kind: 'hardware', condition: 'new', price: PENDING },
  { sku: 'HW-MON-238-FHD', slug: 'monitor-fhd-238', name: 'Monitor Full HD de 23.8 pulgadas', category: 'hardware-pos', kind: 'hardware', condition: 'new', price: PENDING },
  { sku: 'HW-SCANNER', slug: 'barcode-scanner', name: 'Lector de códigos de barras', category: 'hardware-pos', kind: 'hardware', condition: 'new', price: PENDING },
  { sku: 'HW-SCANNER-WL', slug: 'barcode-scanner-wireless', name: 'Lector inalámbrico de códigos de barras', category: 'hardware-pos', kind: 'hardware', condition: 'new', price: PENDING },
  { sku: 'HW-PRINTER', slug: 'thermal-printer', name: 'Impresora térmica de tickets', category: 'hardware-pos', kind: 'hardware', condition: 'new', price: PENDING },
  { sku: 'HW-PRINTER-CUT', slug: 'thermal-printer-autocut', name: 'Impresora térmica con corte automático', category: 'hardware-pos', kind: 'hardware', condition: 'new', price: PENDING },
  { sku: 'HW-POWER', slug: 'power-strip', name: 'Extensión eléctrica', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-KB-MOUSE', slug: 'keyboard-mouse', name: 'Teclado y mouse', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-ACCESSORIES', slug: 'pos-accessories', name: 'Accesorios', category: 'hardware-pos', kind: 'hardware', price: PENDING },
  { sku: 'HW-SCALE', slug: 'scale', name: 'Báscula', category: 'hardware-pos', kind: 'hardware', unit: 'equipo', publicVisible: true, maxQuantity: 5, price: fixed(2000) },

  // Software y licencias
  { sku: 'SW-POS-BASE', slug: 'pos-software-base', name: 'Software POS base', category: 'software-licencias', kind: 'software', price: PENDING },
  { sku: 'SW-POS-MGMT', slug: 'pos-software-management', name: 'Software de gestión instalado', category: 'software-licencias', kind: 'software', price: PENDING },
  { sku: 'SW-POS-CUSTOM', slug: 'pos-software-custom', name: 'Software de gestión personalizado', description: 'Personalización con alcance contractual.', category: 'software-licencias', kind: 'software', price: PENDING },
  { sku: 'SW-WIN11-PRO', slug: 'windows-11-pro', name: 'Windows 11 Pro', category: 'software-licencias', kind: 'license', price: PENDING },

  // Servicios de implementación
  { sku: 'SRV-POS-INSTALL', slug: 'pos-installation', name: 'Instalación', category: 'servicios-implementacion', kind: 'service', price: PENDING },
  { sku: 'SRV-INIT-SUPPORT', slug: 'initial-support', name: 'Soporte inicial', category: 'servicios-implementacion', kind: 'service', price: PENDING },
  { sku: 'SRV-CUSTOM-SW', slug: 'custom-software', name: 'Software personalizado', description: 'Desarrollo a la medida. Se cotiza tras evaluar el alcance.', category: 'servicios-implementacion', kind: 'service', unit: 'proyecto', publicVisible: true, requiresEvaluation: true, price: PENDING },

  // Servicios recurrentes (se muestran aparte del total de implementación)
  { sku: 'MNT-WEB-BASIC', slug: 'maintenance-web-basic', name: 'Mantenimiento web básico', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'monthly', unit: 'mes', publicVisible: true, exclusiveGroup: 'web-maintenance', price: fixed(399) },
  { sku: 'MNT-WEB-BUSINESS', slug: 'maintenance-web-business', name: 'Mantenimiento Web Business', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'monthly', unit: 'mes', publicVisible: true, exclusiveGroup: 'web-maintenance', price: fixed(899) },
  { sku: 'MNT-ECOMMERCE', slug: 'maintenance-ecommerce', name: 'Mantenimiento e-commerce', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'monthly', unit: 'mes', publicVisible: true, exclusiveGroup: 'web-maintenance', price: fixed(1499) },
  { sku: 'MNT-POS', slug: 'support-pos', name: 'Soporte operativo POS', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'monthly', unit: 'mes', publicVisible: true, requiresEvaluation: true, price: from(699) },
  { sku: 'MNT-INTEGRATIONS', slug: 'integration-monitoring', name: 'Monitoreo y soporte de integraciones', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'monthly', unit: 'mes', publicVisible: true, requiresEvaluation: true, price: from(999) },
  // Dominio y hosting: van con todo paquete ($500 al año por ambos) y se descuentan si el cliente ya cuenta con ellos.
  // Reemplazan a «Hosting administrado» (mensual) y «Dominio» (según proveedor), que el seed desactiva.
  { sku: 'INF-HOSTING', slug: 'hosting-annual', name: 'Hosting', description: 'Servidor donde se publica el sistema, por un año.', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'annual', unit: 'año', publicVisible: true, price: fixed(250) },
  { sku: 'INF-DOMAIN', slug: 'domain-annual', name: 'Dominio', description: 'Nombre del sitio (.com o .com.mx), por un año.', category: 'servicios-recurrentes', kind: 'recurring_service', billing: 'annual', unit: 'año', publicVisible: true, price: fixed(250) },
  { sku: 'MNT-LICENSES', slug: 'software-licenses', name: 'Licencias', description: 'Costo según proveedor.', category: 'servicios-recurrentes', kind: 'license', billing: 'third_party_variable', publicVisible: true, price: PENDING },
];

// ---------------------------------------------------------------------------- paquetes

/**
 * Paquetes de versiones anteriores del catálogo. El seed los elimina (con sus versiones de precio)
 * porque el catálogo vigente es el de REAPERSYS_CATALOGO_COTIZADOR.md. Las cotizaciones emitidas
 * conservan su propio snapshot y no se ven afectadas.
 */
export const RETIRED_PACKAGE_SLUGS = [
  'landing-start',
  'web-business',
  'ecommerce-start',
  'ecommerce-pro',
  'pos-integral',
  'pos-premium',
  'pos-personalizado-pro',
  'reaper-business',
  'reaper-commerce',
  'reaper-premium',
  'reaper-commerce-pro',
  'reaper-enterprise',
];

const PROPOSAL_NOTE = 'Distribución de funcionalidades propuesta, pendiente de validación comercial.';
const PENDING_ADDONS_NOTE = 'Los adicionales sin precio aprobado se muestran como «Por cotizar» y no se suman al total.';
const GATEWAYS_NOTE = 'Las pasarelas externas requieren cuentas y credenciales propias; sus comisiones no forman parte del precio de desarrollo.';
const HARDWARE_NOTE = 'El precio corresponde al software. El equipo (hardware) no está incluido y se cotiza por separado.';

const WEB_ADDONS = [
  'web-section',
  'web-internal-page',
  'web-gallery',
  'seo-initial',
  'managed-blog',
  'advanced-visual-design',
  'advanced-animations',
  'whatsapp-button',
  'facebook-button',
  'instagram-button',
  'tiktok-button',
  'email-button',
  'contact-form',
  'quote-form',
  'whatsapp-widget',
  'whatsapp-business-api',
  'crm-integration',
  'chatbot',
];

/** Botones de redes sociales que la Web Corporativa trae incluidos. */
export const CORPORATE_SOCIAL_ITEMS = ['whatsapp-button', 'facebook-button', 'instagram-button', 'tiktok-button'];
export const CORPORATE_SOCIAL_FEATURE = 'Botones de redes sociales (WhatsApp, Facebook, Instagram y TikTok)';

/** Adicionales documentados de la tienda virtual (ARISE Parte 1, §3.2). */
const STORE_ADDONS = [
  'offers-manager',
  'stripe-payments',
  'mercadopago-payments',
  'transfer-proof',
  'order-editing',
  'payment-method-change',
  'order-emails',
  'bulk-sales',
  'whatsapp-button',
  'whatsapp-transfer-notice',
];

/** Adicionales documentados del punto de venta (ARISE Parte 2, §4.2). */
const POS_ADDONS = [
  'pos-csv-import-export',
  'bulk-sales',
  'offers-manager',
  'pos-suppliers',
  'pos-supplier-accounts',
  'pos-credit-sales',
  'pos-advanced-history',
  'pos-returns',
  'pos-expenses',
  'pos-payroll',
  'pos-payroll-advances',
  'pos-reports',
  'pos-savings-goals',
  'pos-users-permissions',
  'scale',
];

const STORE_ITEMS: SeedPackageItem[] = [
  'store-public-site',
  'store-catalog',
  'store-search-filters',
  'store-featured-products',
  'store-cart',
  'store-checkout',
  'store-delivery',
  'store-basic-payments',
  'store-orders',
  'store-integrity',
  'store-contact-info',
  'store-experience',
].map((component) => ({ component }));

const POS_ITEMS: SeedPackageItem[] = [
  'pos-auth',
  'pos-dashboard',
  'pos-products',
  'pos-inventory',
  'pos-register',
  'pos-tickets',
  'pos-customers',
  'pos-sales-history',
  'pos-settings',
].map((component) => ({ component }));

export const seedPackages: SeedPackage[] = [
  {
    slug: 'landing-page',
    name: 'Landing Page',
    category: 'web',
    summary: 'Una landing page profesional para presentar tu negocio.',
    features: ['Una landing page', 'Hasta cuatro secciones', 'Diseño responsive', 'Presentación del negocio', 'Navegación básica', 'Llamado a la acción (CTA) genérico'],
    notes: ['Solo compra (pago único); no se ofrece en renta.'],
    items: [{ component: 'landing-page-build' }, { component: 'web-section', quantity: 4 }],
    addOns: WEB_ADDONS,
    recommendedRecurring: ['maintenance-web-basic'],
    price: { mode: 'fixed', basePesos: 3_499 },
  },
  {
    slug: 'web-corporativa',
    name: 'Web Corporativa',
    category: 'web',
    summary: 'Sitio web corporativo con páginas internas para tu empresa.',
    features: [
      'Página web corporativa',
      'Hasta cuatro páginas internas',
      'Información empresarial',
      'Presentación de servicios',
      'Diseño responsive',
      'Navegación profesional',
      CORPORATE_SOCIAL_FEATURE,
    ],
    notes: ['Solo compra (pago único); no se ofrece en renta.'],
    items: [
      { component: 'corporate-site-build' },
      { component: 'web-internal-page', quantity: 4 },
      ...CORPORATE_SOCIAL_ITEMS.map((component) => ({ component })),
    ],
    addOns: WEB_ADDONS,
    recommendedRecurring: ['maintenance-web-business'],
    price: { mode: 'fixed', basePesos: 7_999 },
  },
  {
    slug: 'tienda-virtual',
    name: 'Tienda Virtual',
    category: 'ecommerce',
    summary: 'Tienda en línea con catálogo, carrito, checkout, pagos básicos y seguimiento de pedidos.',
    features: [
      'Página pública responsive',
      'Catálogo con búsqueda, filtro y paginación',
      'Hasta seis productos destacados',
      'Carrito y checkout',
      'Recoger en tienda o envío a domicilio',
      'Pagos por transferencia o efectivo',
      'Pedidos con estados y consulta segura',
      'Precios y stock validados en el servidor',
    ],
    notes: [PROPOSAL_NOTE, PENDING_ADDONS_NOTE, GATEWAYS_NOTE],
    items: STORE_ITEMS,
    addOns: STORE_ADDONS,
    featured: true,
    price: { mode: 'fixed', basePesos: 14_999 },
  },
  {
    slug: 'punto-de-venta',
    name: 'Punto de Venta (POS)',
    category: 'pos',
    summary: 'Software de punto de venta con caja, inventario, tickets, clientes y dashboard.',
    features: [
      'Inicio de sesión y restricciones de operaciones',
      'Dashboard de ventas e inventario',
      'Productos con códigos, categorías, precios de compra y venta, y stock',
      'Stock mínimo y advertencias',
      'Venta en caja con escaneo por código',
      'Impresión de tickets',
      'Registro de clientes',
      'Historial de ventas',
    ],
    notes: [PROPOSAL_NOTE, PENDING_ADDONS_NOTE, HARDWARE_NOTE],
    items: POS_ITEMS,
    addOns: POS_ADDONS,
    featured: true,
    price: { mode: 'fixed', basePesos: 18_000 },
  },
  {
    slug: 'solucion-combinada',
    name: 'Solución Combinada',
    category: 'combo',
    summary: 'Tienda virtual y punto de venta conectados, con una misma base de datos.',
    features: [
      'Todo lo de la Tienda Virtual',
      'Todo lo del Punto de Venta',
      'Catálogo, inventario y clientes compartidos',
      'Pedidos en línea administrados desde el POS',
    ],
    notes: [
      PROPOSAL_NOTE,
      'El catálogo y el inventario compartidos son parte de la solución integrada; esa conexión no se cobra aparte.',
      PENDING_ADDONS_NOTE,
      GATEWAYS_NOTE,
      HARDWARE_NOTE,
    ],
    // Lo propio de la combinación; lo demás llega desde los dos paquetes contenidos (sin duplicados).
    items: [{ component: 'pos-online-orders' }],
    includesPackages: [{ package: 'tienda-virtual' }, { package: 'punto-de-venta' }],
    comboPolicy: { onEssentialRemoval: 'review', onVariantChange: 'review' },
    addOns: [...new Set([...STORE_ADDONS, ...POS_ADDONS])],
    featured: true,
    price: { mode: 'fixed', basePesos: 27_000 },
  },
  {
    slug: 'software-personalizado',
    name: 'Software Personalizado',
    category: 'custom',
    summary: 'Desarrollo a la medida de tu proceso. Se cotiza tras una evaluación técnica.',
    features: ['Evaluación técnica del proceso', 'Especificación del alcance', 'Desarrollo a la medida'],
    notes: [
      'El precio es un mínimo: el alcance se define con una evaluación técnica y una especificación.',
      'La renta mensual se cotiza según el alcance.',
    ],
    price: { mode: 'starting_at', basePesos: 39_000 },
  },
  {
    slug: 'aun-no-estoy-seguro',
    name: 'Aún no estoy seguro',
    category: 'custom',
    pricingType: 'evaluation',
    summary: 'Cuéntanos qué necesitas y un asesor te recomienda la mejor opción.',
    features: ['Asesoría comercial', 'Recomendación de solución', 'Cotización a la medida'],
    notes: ['No genera un precio automático: un asesor revisa tu necesidad y te contacta.'],
    price: { mode: 'pending' },
  },
];

// ---------------------------------------------------------------------------- suscripción mensual

export interface SeedRentalProfile {
  hostingCostKey: string | null;
  storageGb: number;
  includesDomain: boolean;
  /** Servicios cuyo precio se suma a la mensualidad. */
  services: string[];
  /** Servicios cubiertos con costos de operación (no se pueden contratar aparte). */
  covered: string[];
  /** package_price = precio del paquete; manual = valor por definir (POS: solo software); combo_parts = suma de sus partes. */
  recoverableMode: 'package_price' | 'manual' | 'combo_parts';
  hardwareUpfront: boolean;
  /** 10 000 = cálculo completo. 5 000 = la tienda virtual se renta a la mitad. */
  monthlyRateBp?: number;
  /** Mensualidad de venta aprobada. Sin ella, la renta queda pendiente («a cotizar»). */
  saleMonthlyCents?: number;
  /** Soporte al usuario ya incluido en la mensualidad. */
  supportIncludedCents?: number;
  /** Dominio y hosting, una vez al año y aparte de la mensualidad. */
  infrastructureAnnualCents?: number;
  /** La renta es solo software; no incluye equipo. */
  softwareOnly?: boolean;
}

/**
 * Costos de operación de REFERENCIA (por confirmar con los proveedores reales), en centavos de MXN.
 * Precios de renovación (no promocionales) con el tipo de cambio FIX de Banxico de octubre de 2026 (≈ 18.49).
 */
export const seedOperatingCosts = [
  {
    key: 'hosting-web',
    name: 'Hosting web (VPS 1 vCPU · 4 GB RAM)',
    unit: 'month' as const,
    costCents: 22_170,
    sourceNote: 'Referencia: Hostinger KVM 1, renovación USD 11.99/mes × 18.49 (FIX Banxico, oct 2026). Por confirmar.',
    sourceUrl: 'https://bearhost.com/blogs/hostinger-pricing',
  },
  {
    key: 'hosting-ecommerce',
    name: 'Hosting e-commerce (VPS 2 vCPU · 8 GB RAM)',
    unit: 'month' as const,
    costCents: 27_717,
    sourceNote: 'Referencia: Hostinger KVM 2, renovación USD 14.99/mes × 18.49 (FIX Banxico, oct 2026). Por confirmar.',
    sourceUrl: 'https://hereflowai.com/hostinger-vps-pricing-2026/',
  },
  {
    key: 'storage-gb',
    name: 'Almacenamiento en la nube (por GB)',
    unit: 'gb_month' as const,
    costCents: 28,
    sourceNote: 'Referencia: Cloudflare R2 Standard USD 0.015/GB-mes × 18.49 ≈ $0.28. Por confirmar.',
    sourceUrl: 'https://infratally.com/articles/s3-alternatives-object-storage/',
  },
  {
    key: 'domain-com-mx',
    name: 'Dominio .com.mx (renovación anual)',
    unit: 'year' as const,
    costCents: 39_100,
    sourceNote: 'Referencia: renovación .com.mx $391 MXN/año (Akky lista $347 antes de promoción). Por confirmar.',
    sourceUrl: 'https://norihost.com/dominios/cuanto-cuesta-un-dominio',
  },
];

/**
 * Renta mensual aprobada (§1). No se inventan cuota de instalación, hosting, equipo ni permanencia:
 * el perfil solo fija la mensualidad. Landing Page y Web Corporativa no se rentan.
 */
const rentalAt = (saleMonthlyCents?: number): SeedRentalProfile => ({
  hostingCostKey: null,
  storageGb: 0,
  includesDomain: false,
  services: [],
  covered: [],
  recoverableMode: 'package_price',
  hardwareUpfront: false,
  saleMonthlyCents,
});

const RENTAL_BY_PACKAGE: Record<string, SeedRentalProfile> = {
  'tienda-virtual': rentalAt(100_000),
  'punto-de-venta': rentalAt(70_000),
  'solucion-combinada': rentalAt(150_000),
  // Renta a cotizar: se ofrece, pero la mensualidad queda pendiente.
  'software-personalizado': rentalAt(),
};
for (const pkg of seedPackages) pkg.rental = RENTAL_BY_PACKAGE[pkg.slug];

// ---------------------------------------------------------------------------- reglas

const requires = (subject: string, categories: PackageCategory[], message: string, key?: string): SeedRule => ({
  key: key ?? `${subject}-requires-${categories.join('-or-')}`,
  type: 'requires_package_category',
  subject,
  packageCategories: categories,
  action: 'block',
  message,
});

/** Dependencia entre módulos: sin el módulo requerido, el adicional no se puede contratar. */
const requiresComponent = (subject: string, targets: string[], message: string): SeedRule => ({
  key: `${subject}-requires-${targets.join('-or-')}`,
  type: 'requires_component',
  subject,
  targets,
  action: 'block',
  message,
});

const WEB_OR_STORE ='Disponible al contratar una página web o tienda virtual.';
const STORE_ONLY = 'Disponible al contratar una tienda virtual.';

export const seedRules: SeedRule[] = [
  ...['web-section', 'web-internal-page', 'web-gallery', 'seo-initial', 'managed-blog', 'advanced-visual-design', 'advanced-animations'].map((slug) =>
    requires(slug, ['web', 'ecommerce'], WEB_OR_STORE),
  ),
  ...['whatsapp-button', 'facebook-button', 'instagram-button', 'tiktok-button', 'email-button', 'contact-form', 'quote-form', 'whatsapp-widget'].map(
    (slug) => requires(slug, ['web', 'ecommerce'], WEB_OR_STORE),
  ),
  ...['ecommerce-product', 'payment-gateway', 'advanced-shipping', 'subscriptions', 'wishlist', 'cart-recovery', 'reviews', 'custom-reports'].map(
    (slug) => requires(slug, ['ecommerce'], STORE_ONLY),
  ),
  requires('pos-ecommerce-sync', ['ecommerce'], 'La sincronización requiere una tienda virtual.', 'pos-ecommerce-sync-requires-ecommerce'),
  requires('pos-ecommerce-sync', ['pos'], 'La sincronización requiere un punto de venta.', 'pos-ecommerce-sync-requires-pos'),
  requires('scale', ['pos'], 'La báscula se integra con un paquete de punto de venta.'),
  requires('maintenance-web-basic', ['web'], 'Plan de mantenimiento para sitios web.'),
  requires('maintenance-web-business', ['web'], 'Plan de mantenimiento para sitios web.'),
  requires('maintenance-ecommerce', ['ecommerce'], 'Plan de mantenimiento para tiendas virtuales.'),
  requires('support-pos', ['pos'], 'Soporte para paquetes de punto de venta.'),

  // Módulos ARISE: solo con el paquete al que pertenecen (la Solución Combinada contiene ambos).
  ...STORE_ADDONS.filter((slug) => slug !== 'whatsapp-button' && slug !== 'offers-manager' && slug !== 'bulk-sales').map((slug) =>
    requires(slug, ['ecommerce'], STORE_ONLY),
  ),
  ...POS_ADDONS.filter((slug) => slug !== 'scale' && slug !== 'offers-manager' && slug !== 'bulk-sales').map((slug) =>
    requires(slug, ['pos'], 'Disponible al contratar un punto de venta.'),
  ),
  ...['offers-manager', 'bulk-sales'].map((slug) => requires(slug, ['ecommerce', 'pos'], 'Disponible al contratar una tienda virtual o un punto de venta.')),
  requires('pos-online-orders', ['ecommerce'], 'Los pedidos en línea requieren una tienda virtual conectada.'),
  requiresComponent('pos-supplier-accounts', ['pos-suppliers'], 'Cuentas de proveedores requiere el módulo Proveedores.'),
  requiresComponent('pos-payroll-advances', ['pos-payroll'], 'Adelantos de sueldo requiere el módulo Sueldos.'),
];

// ---------------------------------------------------------------------------- industrias

export const seedIndustries: SeedIndustry[] = [
  { slug: 'tiendas-abarrotes', name: 'Tiendas y abarrotes', description: 'Cobro ágil, control de existencias y tickets en cada venta.', exampleSolutions: ['Punto de venta', 'Inventario', 'Lectores de códigos', 'Impresión de tickets'], suggestedSolutions: ['pos'] },
  { slug: 'restaurantes-cafeterias', name: 'Restaurantes y cafeterías', description: 'Pedidos, menú digital y control de ventas en un solo flujo.', exampleSolutions: ['Gestión de pedidos', 'Menús digitales', 'Control de ventas', 'Sistemas POS compatibles'], suggestedSolutions: ['pos', 'landing'] },
  { slug: 'boutiques', name: 'Boutiques', description: 'Vende en línea con catálogo, tallas, colores e inventario.', exampleSolutions: ['Tienda virtual', 'Catálogo', 'Variantes', 'Inventario'], suggestedSolutions: ['ecommerce'] },
  { slug: 'barberias-salones', name: 'Barberías y salones', description: 'Presencia web, reservaciones y contacto directo por WhatsApp.', exampleSolutions: ['Página web', 'Reservaciones', 'Formularios', 'WhatsApp'], suggestedSolutions: ['landing', 'web'] },
  { slug: 'farmacias', name: 'Farmacias', description: 'Venta de productos con control de existencias adecuado al giro.', exampleSolutions: ['Inventario', 'Venta de productos', 'Control de existencias', 'POS adecuado al giro'], suggestedSolutions: ['pos'] },
  { slug: 'ferreterias-papelerias', name: 'Ferreterías y papelerías', description: 'Catálogos amplios de productos con inventario y reportes.', exampleSolutions: ['Punto de venta', 'Productos', 'Inventario', 'Reportes'], suggestedSolutions: ['pos'] },
  { slug: 'consultorios', name: 'Consultorios', description: 'Sitio profesional con formularios y agendamiento de citas.', exampleSolutions: ['Página corporativa', 'Formularios', 'Agendamiento', 'Gestión de contacto'], suggestedSolutions: ['web'] },
  { slug: 'empresas-servicios', name: 'Empresas de servicios', description: 'Sitio corporativo, CRM y automatizaciones para captar clientes.', exampleSolutions: ['Sitios corporativos', 'CRM', 'Formularios', 'Automatizaciones'], suggestedSolutions: ['web', 'custom'] },
  { slug: 'negocios-sucursales', name: 'Negocios con sucursales', description: 'Gestión comercial e integraciones entre puntos de venta.', exampleSolutions: ['Gestión comercial', 'Software personalizado', 'Punto de venta', 'Integraciones'], suggestedSolutions: ['combo', 'custom'] },
];

// ---------------------------------------------------------------------------- configuración

export const seedSettings = {
  key: 'default',
  tradeName: 'ReaperSys',
  currency: 'MXN' as const,
  tax: { rateBp: 0, treatment: 'exclusive' as const, confirmed: true },
  // Anticipo sugerido 50 % (brief §12). Vigencia confirmada por la empresa (2026-10-17): 7 días.
  quote: { depositRateBp: 5_000, validityDays: 7, folioPrefix: 'RS' },
  // Suscripción confirmada por la empresa (2026-10-17): plazo mínimo de 12 meses; sin recargo por financiamiento por defecto.
  rental: { minimumTermMonths: 12, financingBp: 0, monthToMonthSurchargeBp: 1_500, semiannualDiscountBp: 500, annualDiscountBp: 1_000 },
  // Garantía de referencia 90 días (brief §12), pendiente de confirmar.
  warranty: { referenceDays: 90, confirmed: false },
  contact: {},
  // El aviso de privacidad se publica desde el panel una vez revisado y con los datos del responsable.
  privacyNotice: { published: false, publishedAt: null },
  commercialTerms: [
    'Precios en pesos mexicanos (MXN).',
    'Anticipo sugerido del 50 % y liquidación del 50 % restante.',
    'Los precios expresados como "desde" son mínimos comerciales sujetos a evaluación del alcance.',
    'Los servicios recurrentes se cobran por separado del costo de implementación.',
    'Dominio y hosting: $500 al año por ambos, aparte del precio del paquete; se descuenta lo que el cliente ya tenga.',
    'Los costos de terceros (licencias, comisiones de pasarelas) dependen de cada proveedor.',
  ],
};
