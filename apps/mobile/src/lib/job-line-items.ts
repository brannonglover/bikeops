import { type Job, type JobProduct, type JobService, type Product, type Service } from "@/lib/types";

type ServiceCatalogEntry = Pick<Service, "id" | "name"> & {
  description?: string | null;
  slug?: string | null;
  isSystem?: boolean;
  price?: string | number;
};

type ProductCatalogEntry = Pick<Product, "id" | "name"> & {
  description?: string | null;
  supplier?: string | null;
  stockQuantity?: number;
  price?: string | number;
};

export function getJobServiceDisplayName(
  js: JobService,
  catalog: ServiceCatalogEntry[] = []
): string {
  if (js.service?.name) return js.service.name;
  if (js.customServiceName?.trim()) return js.customServiceName.trim();
  if (js.serviceId) {
    const fromCatalog = catalog.find((s) => s.id === js.serviceId);
    if (fromCatalog?.name) return fromCatalog.name;
  }
  return "Unknown";
}

export function getJobProductDisplayName(
  jp: JobProduct,
  catalog: ProductCatalogEntry[] = []
): string {
  if (jp.product?.name) return jp.product.name;
  if (jp.productId) {
    const fromCatalog = catalog.find((p) => p.id === jp.productId);
    if (fromCatalog?.name) return fromCatalog.name;
  }
  return "Unknown";
}

function serviceFromCatalog(
  entry: ServiceCatalogEntry,
  unitPrice: string | number
): Service {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? null,
    price: String(entry.price ?? unitPrice),
    slug: entry.slug ?? null,
    isSystem: entry.isSystem ?? false,
    createdAt: "",
    updatedAt: "",
  };
}

function productFromCatalog(
  entry: ProductCatalogEntry,
  unitPrice: string | number
): Product {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? null,
    imageUrl: null,
    price: String(entry.price ?? unitPrice),
    stockQuantity: entry.stockQuantity ?? 0,
    supplier: entry.supplier ?? null,
    createdAt: "",
    updatedAt: "",
  };
}

export function enrichJobService(
  js: JobService,
  catalog: ServiceCatalogEntry[] = []
): JobService {
  if (js.service?.name) return js;
  if (!js.serviceId) return js;
  const entry = catalog.find((s) => s.id === js.serviceId);
  if (!entry) return js;
  return { ...js, service: serviceFromCatalog(entry, js.unitPrice) };
}

export function enrichJobProduct(
  jp: JobProduct,
  catalog: ProductCatalogEntry[] = []
): JobProduct {
  if (jp.product?.name) return jp;
  const entry = catalog.find((p) => p.id === jp.productId);
  if (!entry) return jp;
  return { ...jp, product: productFromCatalog(entry, jp.unitPrice) };
}

export function enrichJobFromCatalogs(
  job: Job,
  services: ServiceCatalogEntry[] = [],
  products: ProductCatalogEntry[] = []
): Job {
  return {
    ...job,
    jobServices: (job.jobServices ?? []).map((js) => enrichJobService(js, services)),
    jobProducts: (job.jobProducts ?? []).map((jp) => enrichJobProduct(jp, products)),
  };
}
