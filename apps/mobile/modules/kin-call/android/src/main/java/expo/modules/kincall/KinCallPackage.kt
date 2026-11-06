package expo.modules.kincall

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

/** Ouverture par l'appel d'une nouvelle course : l'application s'affiche par-dessus l'écran verrouillé. */
class KinCallPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> {
    return listOf(KinCallLifecycleListener())
  }
}

class KinCallLifecycleListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    if (activity == null) return
    KinCall.activity = WeakReference(activity)
    if (activity.intent?.getBooleanExtra(KinCall.EXTRA_CALL, false) == true) KinCall.showOverLockScreen(activity)
  }

  override fun onResume(activity: Activity?) {
    if (activity != null) KinCall.activity = WeakReference(activity)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    if (intent?.getBooleanExtra(KinCall.EXTRA_CALL, false) == true) {
      KinCall.activity?.get()?.let { KinCall.showOverLockScreen(it) }
    }
    return false
  }
}
