import {requireUser} from "@/lib/auth";
import {env} from "@/lib/env";
import {WidgetCodes} from "./widget-codes";
export default async function WidgetsPage(){await requireUser("integrations.read");return <section><h1>Widgets & κώδικας ενσωμάτωσης</h1><p>Αντιγράψτε τον κώδικα στη σελίδα WordPress ή HTML του Hotel Corali. Η τιμή του rate widget φορτώνεται από πραγματική διαθεσιμότητα· κανάλια χωρίς πραγματικά δεδομένα δεν προβάλλονται.</p><WidgetCodes origin={env().BOOKING_ORIGIN}/></section>}
