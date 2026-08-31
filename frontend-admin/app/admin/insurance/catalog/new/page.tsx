'use client';

import Link from 'next/link';
import { PageHeader, InsuranceTabs, Card, DisclosureNote, btn, btnPrimary } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

/**
 * "New product" — deliberately NOT a form.
 *
 * This route used to render a full create-product form (code, underwriter,
 * premium, commission basis, sum-insured bounds) wired to an upsertProduct()
 * call that, in fixture mode, mutated an in-memory array and returned success.
 * An operator filling it in got a "saved" result for a product that existed
 * nowhere.
 *
 * Beyond the fake write, the form encoded a wrong model of the business. We do
 * not author insurance products: MyCover.ai does, and each product carries a
 * bespoke purchase route and its own required-field schema that cannot be
 * derived from anything typed here. Our catalog is a projection of theirs. The
 * only correct way to add a product is to sync it, so this page routes to the
 * sync action rather than pretending a create path exists.
 */
export default function InsuranceNewProductPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Add a product"
        subtitle="Products are not authored here — they come from the MyCover.ai catalog."
        action={
          <Link href="/admin/insurance/catalog" style={{ ...btn(), textDecoration: 'none' }}>
            Back to catalog
          </Link>
        }
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        Paymax distributes cover written by NAICOM-licensed insurers and sourced through MyCover.ai.
        Product terms, pricing and the commission split are set by the underwriter and the aggregator —
        not by this console.
      </DisclosureNote>

      <Card title="There is no manual create step">
        <p style={{ fontSize: '0.88rem', color: colors.text, lineHeight: 1.6, marginTop: 0 }}>
          Our catalog is a mirror of MyCover&rsquo;s. Each product carries a purchase route and a
          required-field schema that are specific to that product and cannot be inferred — two products
          from the same underwriter can demand entirely different fields. A hand-typed row would have a
          code we invented, no purchase route, and no schema, so nothing could ever be sold against it.
        </p>
        <p style={{ fontSize: '0.88rem', color: colors.text, lineHeight: 1.6 }}>
          To bring a product in, run <strong>Sync from MyCover</strong> on the catalog screen. That pulls
          the live product list, its pricing, cover periods, capability flags and commission bands into
          our database in one pass.
        </p>
        <p style={{ fontSize: '0.82rem', color: colors.muted, lineHeight: 1.6 }}>
          What this console <em>can</em> change is whether a synced product is offered: open any product
          and use Activate / Deactivate, which writes straight to the catalog.
        </p>
        <Link href="/admin/insurance/catalog" style={{ ...btnPrimary(), textDecoration: 'none', display: 'inline-block' }}>
          Go to the catalog and sync
        </Link>
      </Card>
    </div>
  );
}
