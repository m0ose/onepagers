/**
 * Below is all stuff for batch processing videos when idle
 *
 * */
async function getAllVideos(rootDB) {
    const ref = rootDB.child('/alertwildfirebackup/firecams/videos')
    const snap = await ref.once('value')
    const val = snap.val()
    // gather all of the videos in the nested object list on firebase.
    function walkVideos(a) {
        let res = []
        for (const i in a) {
            if (typeof a[i] === 'object' && a[i] !== null) {
                const b = walkVideos(a[i])
                if (b) res = res.concat(b)
            } else if (i == 'url') {
                res.push(a[i])
            }
        }
        return res
    }

    const allVids = walkVideos(val)
    return allVids
}

async function getMediaObject(dbRef, url) {

}

function monitorForIdle(queueRef, callback, minIdleTime=15000){
    let timeoutID = undefined
    queueRef.child('available').on('value',(snap)=>{
        clearTimeout(timeoutID)
        timeoutID = undefined
        const count = snap.numChildren()
        if(count === 0){
            timeoutID = setTimeout(callback, minIdleTime)
        }
    })
}
// setTimeout(async () => {
//         console.log(await getAllVideos(db.ref()))
// }, 1000);

function searchWithOCR(
    media,
    startMediaTime,
    endMediaTime,
    startObj,
    endData
) {}
