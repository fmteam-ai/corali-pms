import { requireUser } from "@/lib/auth";
import { policyTextsFrom } from "@/lib/booking-policy";
import { db } from "@/lib/db";
import { getPaymentPolicy } from "@/lib/payment-policy-db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { PolicyForm } from "./form";
import { PlanTermsEditor, PolicyTextsEditor } from "./plan-terms";

export default async function Page() {
  const u = await requireUser("pricing.read");
  const { lang, t } = await getPmsT();
  const [policy, plans, cancellation, texts] = await Promise.all([
    getPaymentPolicy(u.ownerId),
    db().query(`SELECT plan_key,name,adjustment_percent,active,deposit_percent,balance_mode,balance_days_before,full_prepayment,cancellation_days FROM rate_plans WHERE owner_id=$1 ORDER BY CASE plan_key WHEN 'flexible' THEN 1 WHEN 'direct_web' THEN 2 ELSE 3 END,plan_key`, [u.ownerId]),
    db().query(`SELECT free_cancellation_days FROM cancellation_policies WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1`, [u.ownerId]),
    db().query(`SELECT texts_json FROM booking_policy_texts WHERE owner_id=$1`, [u.ownerId]),
  ]);
  const canEdit = can(u.role, "pricing.write", u.permissions);
  return (
    <section className="paymentPolicyPage">
      <div className="pageTitle"><div><h1>{t("pp.title")}</h1><p>{t("pp.subtitle")}</p></div></div>
      <article className="card"><h2>{t("pp.general")}</h2><p>{t("pp.generalHelp")}</p><PolicyForm initial={policy} /></article>
      <PlanTermsEditor lang={lang} canEdit={canEdit} cancellationDays={Number(cancellation.rows[0]?.free_cancellation_days ?? 7)} general={policy} plans={plans.rows.map((p) => ({ planKey: p.plan_key, name: p.name, active: Number(p.active) === 1, depositPercent: p.deposit_percent === null ? null : Number(p.deposit_percent), balanceMode: p.balance_mode ?? "general", balanceDaysBefore: p.balance_days_before === null ? null : Number(p.balance_days_before), fullPrepayment: Number(p.full_prepayment) === 1, cancellationDays: p.cancellation_days === null || p.cancellation_days === undefined ? null : Number(p.cancellation_days) }))} />
      <PolicyTextsEditor lang={lang} canEdit={canEdit} initial={policyTextsFrom(texts.rows[0]?.texts_json)} />
    </section>
  );
}
